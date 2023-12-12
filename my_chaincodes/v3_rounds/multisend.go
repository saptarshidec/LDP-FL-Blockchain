package main

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"math/rand"
	"github.com/hyperledger/fabric-contract-api-go/contractapi"
)

type RoundData struct{
	Round int `json:"round"`
	Data string `json:"data"`
}

type ClientData struct {
    ClientID string `json:"clientID"`
    Data []RoundData `json:"data"`
	Tokens int 		`json:"tokens"`
    Round  int    `json:"round"`
	RoundSeen []int `json:"roundSeen"`
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
		Data: []RoundData{},
		Tokens:0,
		Round: 0,
		RoundSeen: []int{},
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

func (sc *SmartContract) PutData(ctx contractapi.TransactionContextInterface, data string, serverCN string) error {
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
	clientData.Round = roundNumber
	clientData.Data = append(clientData.Data, RoundData{Round: roundNumber, Data: data})

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
func (sc *SmartContract) GetRoundData(ctx contractapi.TransactionContextInterface, num int, seed int) ([]string, error) {

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
		return nil, fmt.Errorf("failed to unmarshal client data: %v", err)
	}

	round = clientData.Round + 1
	fmt.Printf("Round: %v\n", round)
	selectedClients, err := SelectSubSet(ctx, num, seed)
	fmt.Printf("Selected clients length: %v\n", len(selectedClients))
	if err != nil {
		return nil, fmt.Errorf("failed to select subset: %v", err)
	}

	var clientDataList []string

	for _, clientCN := range selectedClients {
		clientDataAsBytes, err := ctx.GetStub().GetState(clientCN)
		fmt.Printf("Currently working on client: %s\n", clientCN)
		if err != nil {
			return nil, fmt.Errorf("failed to read from world state: %v", err)
		}

		var clientData ClientData
		err = json.Unmarshal(clientDataAsBytes, &clientData)
		if err != nil {
			return nil, fmt.Errorf("failed to unmarshal client data: %v", err)
		}

		for _, roundData := range clientData.Data {
			if roundData.Round == round {
				clientDataList = append(clientDataList, roundData.Data)
				// now increase tokens of the client
				clientData.Tokens = clientData.Tokens + 1
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
	}

	return clientDataList, nil
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
func (sc *SmartContract) GetResult(ctx contractapi.TransactionContextInterface, serverCN string, round int) (string, error) {
	
	clientID, err := ctx.GetClientIdentity().GetID()
	if err != nil {
		return "", fmt.Errorf("failed to get client ID: %v", err)
	}

	clientData, err := getData(ctx, clientID)
	if err != nil {
		return "", fmt.Errorf("failed to get client data: %v", err)
	}
	
	clientCN, err := GetCNFromClientID(clientID)
	if err != nil {
		return "", fmt.Errorf("failed to get CN from client ID: %v", err)
	}

	serverDataAsBytes, err := ctx.GetStub().GetState(serverCN)
	if err != nil {
		return "", fmt.Errorf("failed to read from world state: %v", err)
	}

	if serverDataAsBytes == nil {
		return "", fmt.Errorf("the server data %s does not exist", serverCN)
	}

	var serverData ClientData
	err = json.Unmarshal(serverDataAsBytes, &serverData)
	if err != nil {
		return "", fmt.Errorf("failed to unmarshal server data: %v", err)
	}

	var serverRoundData RoundData = RoundData{}
	for _, roundData := range serverData.Data {
		fmt.Printf("Round: %v, Data: %s\n", roundData.Round, roundData.Data)
		if roundData.Round == round {
			serverRoundData = roundData
		}
	}

	if serverRoundData.Round == 0 {
		return "", fmt.Errorf("server %s has no data for round %v", serverCN, round)
	}

	// check if client has already seen the round
	for _, roundSeen := range clientData.RoundSeen {
		if roundSeen == round {
			fmt.Printf("Client %s has already seen round %v\n", clientCN, round)
			return serverRoundData.Data, nil
		}
	}

	if clientData.Tokens == 0 {
		return "", fmt.Errorf("client %s has no tokens", clientCN)
	}

	clientData.RoundSeen = append(clientData.RoundSeen, round)
	clientData.Tokens = clientData.Tokens - 1
	fmt.Printf("Client %s got data for round %v\n", clientCN, clientData)
	clientDataAsBytes, err := json.Marshal(clientData)
	if err != nil {
		return "", fmt.Errorf("failed to marshal client data: %v", err)
	}

	err = ctx.GetStub().PutState(clientCN, clientDataAsBytes)
	if err != nil {
		return "", fmt.Errorf("failed to write to world state: %v", err)
	}

	return serverRoundData.Data, nil
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
