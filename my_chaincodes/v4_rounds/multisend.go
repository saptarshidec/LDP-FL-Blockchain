package main

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"math/rand"
	"github.com/hyperledger/fabric-contract-api-go/contractapi"
)

type Layer struct {
	Weights interface {} `json:"weights"`
	Biases []float64 `json:"biases"`
}

type NeuralNetworkModel struct {
	Layers[] Layer `json:"layers"`
}

type ClientData struct {
    ClientID string `json:"clientID"`
    Data NeuralNetworkModel `json:"data"`
	Tokens float64 		`json:"tokens"`
    Round  int    `json:"round"`
	RoundSeen []int `json:"roundSeen"`
	Epsilon float64		`json:"epsilon"`
}

type PolledClients struct{
	ClientID string `json:"clientID"`
}

type SmartContract struct {
    contractapi.Contract
}

func GetCNFromClientID(clientID string) (string, error) {
	
	decodedBytes, err:= base64.StdEncoding.DecodeString(clientID)
	if err != nil {
		return "", fmt.Errorf("failed to decode client ID: %v", err)
	}

	clientID = string(decodedBytes)

	cn := ""
	for _, s := range clientID {
		if s == '=' {
			cn = ""
		} else if s == ',' {
			break
		} else {
			cn = cn + string(s)
		}
	}
	fmt.Printf("Client ID: %s, cn: %s\n", clientID, cn)
	return cn, nil
}

func (sc *SmartContract) InitLedger(ctx contractapi.TransactionContextInterface) error {
	clientID, err := ctx.GetClientIdentity().GetID()
	if err != nil {
		return fmt.Errorf("failed to get client ID: %v", err)
	}

	cn, err := GetCNFromClientID(clientID)
	if err != nil {
		return fmt.Errorf("failed to get CN from client ID: %v", err)
	}

	InitClientData, err := ctx.GetStub().GetState(cn)
	if err != nil {
		return fmt.Errorf("failed to read from world state: %v", err)
	}

	if InitClientData != nil {
		return fmt.Errorf("the client data %s already exists", cn)
	}

	clientData := ClientData{
		ClientID: clientID,
		Data: NeuralNetworkModel{
			Layers: []Layer{
				Layer{
					Weights: nil,
					Biases: nil,
				},
			},
		},					
		Tokens:0,
		Round: 0,
		RoundSeen: []int{},
		Epsilon: 0,
	}

	clientDataAsBytes, err := json.Marshal(clientData)
	if err != nil {
		return fmt.Errorf("failed to marshal client data: %v", err)
	}

	err = ctx.GetStub().PutState(cn, clientDataAsBytes)
	if err != nil {
		return fmt.Errorf("failed to write to world state: %v", err)
	}

	return nil
}

func getServerRound(ctx contractapi.TransactionContextInterface, cn string) (int, error) {
	serverDataAsBytes, err := ctx.GetStub().GetState(cn)
	if err != nil {
		return 0, fmt.Errorf("failed to read from world state: %v", err)
	}

	if serverDataAsBytes == nil {
		return 0, fmt.Errorf("the server data %s does not exist", cn)
	}

	var serverData ClientData
	err = json.Unmarshal(serverDataAsBytes, &serverData)
	if err != nil {
		return 0, fmt.Errorf("failed to unmarshal server data: %v", err)
	}

	return serverData.Round, nil
}

func (sc *SmartContract) PutData(ctx contractapi.TransactionContextInterface, data string, serverCN string, epsilon float64) error {
	clientID, err := ctx.GetClientIdentity().GetID()
	if err != nil {
		return fmt.Errorf("failed to get client ID: %v", err)
	}

	cn, err := GetCNFromClientID(clientID)
	if err != nil {
		return fmt.Errorf("failed to get CN from client ID: %v", err)
	}

	clientDataAsBytes, err := ctx.GetStub().GetState(cn)
	if err != nil {
		return fmt.Errorf("failed to read from world state: %v", err)
	}

	var clientData ClientData

	err = json.Unmarshal(clientDataAsBytes, &clientData)
	if err != nil {
		return fmt.Errorf("failed to unmarshal client data: %v", err)
	}

	serverRound, err := getServerRound(ctx, serverCN)
	if err != nil {
		return fmt.Errorf("failed to get server round: %v", err)
	}
	roundNumber := clientData.Round + 1
	if serverRound > clientData.Round {
		roundNumber = serverRound + 1
	}

	var newModelData NeuralNetworkModel
	err = json.Unmarshal([]byte(data), &newModelData)
	if err != nil {
		return fmt.Errorf("failed to unmarshal data: %v", err)
	}

	clientData.Data = newModelData
	clientData.Round = roundNumber
	clientData.Epsilon = epsilon;

	clientDataAsBytes, err = json.Marshal(clientData)
	if err != nil {
		return fmt.Errorf("failed to marshal client data: %v", err)
	}

	err = ctx.GetStub().PutState(cn, clientDataAsBytes)
	if err != nil {
		return fmt.Errorf("failed to write to world state: %v", err)
	}

	return nil
}

// select random subset of size num from the list of clients
func SelectSubSet(ctx contractapi.TransactionContextInterface, num int, seed int) ([]string, error) {

	rand.Seed(int64(seed))
	var clientList []string
	keysIter, err := ctx.GetStub().GetStateByRange("", "")
	if err != nil {
		return nil, fmt.Errorf("failed to get all keys: %v", err)
	}
	defer keysIter.Close()

	for keysIter.HasNext() {
		queryResponse, err := keysIter.Next()
		if err != nil {
			continue
		}
		if (len(queryResponse.Key) >= 15 && queryResponse.Key[:15] == "Polled_Clients_") || (len(queryResponse.Key) >= 9 && queryResponse.Key[:9] == "appserver") {
			continue
		}
		clientList = append(clientList, queryResponse.Key)
	}

	// if less are there, send all
	if len(clientList) <= num {
		return clientList, nil
	}

	// select distinct random num clients
	var selectedClients []string
	for i := 0; i < num; i++ {
		randIndex := rand.Intn(len(clientList))
		selectedClients = append(selectedClients, clientList[randIndex])
		clientList = append(clientList[:randIndex], clientList[randIndex+1:]...)
	}

	return selectedClients, nil
}

// get data of random num clients
func (sc *SmartContract) GetRoundData(ctx contractapi.TransactionContextInterface, num int, seed int) ([]NeuralNetworkModel, error) {

	var round int
	clientID, err := ctx.GetClientIdentity().GetID()
	if err != nil {
		return nil, fmt.Errorf("failed to get client ID: %v", err)
	}

	cn, err := GetCNFromClientID(clientID)
	if err != nil {
		return nil, fmt.Errorf("failed to get CN from client ID: %v", err)
	}

	clientDataAsBytes, err := ctx.GetStub().GetState(cn)
	if err != nil {
		return nil, fmt.Errorf("failed to read from world state: %v", err)
	}

	var clientData ClientData
	err = json.Unmarshal(clientDataAsBytes, &clientData)
	if err != nil {
		return nil, fmt.Errorf("failed to unmarshal1 client data: %v", err)
	}

	round = clientData.Round + 1
	fmt.Printf("Round: %v\n", round)
	selectedClients, err := SelectSubSet(ctx, num, seed)
	numClients:=len(selectedClients)
	fmt.Printf("Selected clients length: %v\n", len(selectedClients))
	if err != nil {
		return nil, fmt.Errorf("failed to select subset: %v", err)
	}

	// serverDataAsBytes, err := ctx.GetStub().GetState(serverCN)
	// if err != nil {
	// 	return "", fmt.Errorf("failed to read from world state: %v", err)
	// }

	// if serverDataAsBytes == nil {
	// 	return "", fmt.Errorf("the server data %s does not exist", serverCN)
	// }

	// var serverData ClientData
	// err = json.Unmarshal(serverDataAsBytes, &serverData)
	// if err != nil {
	// 	return "", fmt.Errorf("failed to unmarshal server data: %v", err)
	// }

	var clientModelData[] NeuralNetworkModel
	var total_inverse_epsilon float64=0.0

	for _, clientCN := range selectedClients {
		clientDataAsBytes, err := ctx.GetStub().GetState(clientCN)
		fmt.Printf("Currently working on client: %s\n", clientCN)
		if err != nil {
			return nil, fmt.Errorf("failed to read from world state: %v", err)
		}

		var clientData ClientData
		err = json.Unmarshal(clientDataAsBytes, &clientData)
		if err != nil {
			return nil, fmt.Errorf("failed to unmarshal2 client data: %v", err)
		}
		//for _, roundData := range clientData.Data {
			//if roundData.Round == round {
			//	total_inverse_epsilon+=(1.0/clientData.Epsilon)
			//}
		//}
		if clientData.Round==round{
			total_inverse_epsilon+=(1.0/clientData.Epsilon)
		}
	}

	for _, clientCN := range selectedClients {

		clientDataAsBytes, err := ctx.GetStub().GetState(clientCN)
		fmt.Printf("Currently working on client: %s\n", clientCN)
		if err != nil {
			return nil, fmt.Errorf("failed to read from world state: %v", err)
		}

		var clientData ClientData
		err = json.Unmarshal(clientDataAsBytes, &clientData)
		if err != nil {
			return nil, fmt.Errorf("failed to unmarshal3 client data: %v", err)
		}

		//for _, roundData := range clientData.Data {
			//if roundData.Round == round {
			if clientData.Round==round{
				// clientDataList = append(clientDataList, roundData.Data)
				clientModelData = append(clientModelData, clientData.Data)
				// now increase tokens of the client according to epsilon
				clientData.Tokens = clientData.Tokens + ((1.0/clientData.Epsilon)/total_inverse_epsilon)*float64(numClients)
				clientDataAsBytes, err = json.Marshal(clientData)
				if err != nil {
					fmt.Printf("failed to marshal client %s data: %v\n", clientCN, err)
					continue
				}
				err = ctx.GetStub().PutState(clientCN, clientDataAsBytes)
				if err != nil {
					fmt.Printf("failed to write to world state for client %s, %v\n", clientCN, err)
					continue
				}
				fmt.Printf("Client %s has %v tokens\n", clientCN, clientData.Tokens)
			}
		
	}

	// serverData.Tokens=serverData.Tokens*(9/10.0) //server reduces its own tokens

	// serverDataAsBytes, err = json.Marshal(serverData)
	// if err != nil {
	// 	return "", fmt.Errorf("failed to marshal client data: %v", err)
	// }

	// err = ctx.GetStub().PutState(serverCN, serverDataAsBytes)
	// if err != nil {
	// 	return "", fmt.Errorf("failed to write to world state: %v", err)
	// }

	return clientModelData, nil
}


func getData(ctx contractapi.TransactionContextInterface, clientID string) (ClientData, error) {
	cn, err := GetCNFromClientID(clientID)
	if err != nil {
		return ClientData{}, fmt.Errorf("failed to get CN from client ID: %v", err)
	}

	clientDataAsBytes, err := ctx.GetStub().GetState(cn)
	if err != nil {
		return ClientData{}, fmt.Errorf("failed to read from world state: %v", err)
	}

	if clientDataAsBytes == nil {
		return ClientData{}, fmt.Errorf("the client data %s does not exist", clientID)
	}
	var clientData ClientData
	err = json.Unmarshal(clientDataAsBytes, &clientData)
	if err != nil {
		return ClientData{}, fmt.Errorf("failed to unmarshal client data: %v", err)
	}

	return clientData, nil
}

// get data of requested client
func (sc *SmartContract) GetData(ctx contractapi.TransactionContextInterface) (ClientData, error) {
	clientID, err := ctx.GetClientIdentity().GetID()
	if err != nil {
		return ClientData{}, fmt.Errorf("failed to get client ID: %v", err)
	}

	return getData(ctx, clientID)
}


// get the data pushed by the server
func (sc *SmartContract) GetResult(ctx contractapi.TransactionContextInterface, serverCN string, round int) (NeuralNetworkModel, error) {
	
	clientID, err := ctx.GetClientIdentity().GetID()
	if err != nil {
		return NeuralNetworkModel{}, fmt.Errorf("failed to get client ID: %v", err)
	}

	clientData, err := getData(ctx, clientID)
	if err != nil {
		return NeuralNetworkModel{}, fmt.Errorf("failed to get client data: %v", err)
	}
	
	clientCN, err := GetCNFromClientID(clientID)
	if err != nil {
		return NeuralNetworkModel{}, fmt.Errorf("failed to get CN from client ID: %v", err)
	}

	serverDataAsBytes, err := ctx.GetStub().GetState(serverCN)
	if err != nil {
		return NeuralNetworkModel{}, fmt.Errorf("failed to read from world state: %v", err)
	}

	if serverDataAsBytes == nil {
		return NeuralNetworkModel{}, fmt.Errorf("the server data %s does not exist", serverCN)
	}

	var serverData ClientData
	err = json.Unmarshal(serverDataAsBytes, &serverData)
	if err != nil {
		return NeuralNetworkModel{}, fmt.Errorf("failed to unmarshal server data: %v", err)
	}

	var serverRoundData NeuralNetworkModel
	// for _, roundData := range serverData.Data {
	if serverData.Round==round{
		serverRoundData=serverData.Data
		fmt.Printf("Round: %v, Data: %s\n", round, serverRoundData.Layers[0].Weights)
		// if roundData.Round == round {
		// 	serverRoundData = roundData
		// }
		// if serverRoundData.Round == round {
		// 	serverRoundData = roundData
		// }
	}

	if serverData.Round == 0 {
		return NeuralNetworkModel{}, fmt.Errorf("server %s has no data for round %v", serverCN, round)
	}

	// check if client has already seen the round
	for _, roundSeen := range clientData.RoundSeen {
		if roundSeen == round {
			fmt.Printf("Client %s has already seen round %v\n", clientCN, round)
			return serverData.Data, nil
		}
	}

	if clientData.Tokens <1 {
		return NeuralNetworkModel{}, fmt.Errorf("client %s does not have sufficient tokens", clientCN)
	}

	//check how many tokens the server has remaining, and calculate the cost of the client
	// var tokens_remaining float=serverData.Tokens
	// var cost float=tokens_remaining*(1/9.0)*(1/3.0)

	clientData.RoundSeen = append(clientData.RoundSeen, round)
	clientData.Tokens = clientData.Tokens - 1 //consuming tokens from client

	fmt.Printf("Client %s got data for round %v\n", clientCN, clientData)
	clientDataAsBytes, err := json.Marshal(clientData)
	if err != nil {
		return NeuralNetworkModel{}, fmt.Errorf("failed to marshal client data: %v", err)
	}

	err = ctx.GetStub().PutState(clientCN, clientDataAsBytes)
	if err != nil {
		return NeuralNetworkModel{}, fmt.Errorf("failed to write to world state: %v", err)
	}

	// serverData.Tokens = serverData.Tokens + cost //returning tokens to server

	// serverDataAsBytes, err = json.Marshal(serverData)
	// if err != nil {
	// 	return "", fmt.Errorf("failed to marshal client data: %v", err)
	// }

	// err = ctx.GetStub().PutState(serverCN, serverDataAsBytes)
	// if err != nil {
	// 	return "", fmt.Errorf("failed to write to world state: %v", err)
	// }

	return serverData.Data, nil
}

func main() {
	
	chaincode, err := contractapi.NewChaincode(new(SmartContract))

	if err != nil {
		fmt.Printf("Error create testchaincode chaincode: %s", err.Error())
		return
	}

	err = chaincode.Start()

	if err != nil {
		fmt.Printf("Error starting testchaincode chaincode: %s", err.Error())
	}
}
