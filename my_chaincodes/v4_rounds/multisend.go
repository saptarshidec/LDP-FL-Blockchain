package main

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"github.com/hyperledger/fabric-contract-api-go/contractapi"
	"math/rand"
	"reflect"
)

type Layer struct {
	Weights interface{} `json:"weights"`
	Biases  []float64   `json:"biases"`
}

type NeuralNetworkModel struct {
	Layers []Layer `json:"layers"`
}

type ClientData struct {
	ClientID  string             `json:"clientID"`
	Data      NeuralNetworkModel `json:"data"`
	Tokens    float64            `json:"tokens"`
	Round     int                `json:"round"`
	RoundSeen []int              `json:"roundSeen"`
	Epsilon   float64            `json:"epsilon"`
}

type PolledClients struct {
	ClientID string `json:"clientID"`
}

type SmartContract struct {
	contractapi.Contract
}

func addMatricesFloat64(a, b interface{}) (interface{}, error) {
    va := reflect.ValueOf(a)
    vb := reflect.ValueOf(b)

    // Ensure both matrices have the same type and dimensionality
    if va.Type() != vb.Type() || va.Kind() != reflect.Slice || vb.Kind() != reflect.Slice {
        return nil, fmt.Errorf("matrices must have the same type and dimensionality")
    }

    // Recursively add elements using direct float64 operations
    result := reflect.MakeSlice(va.Type(), va.Len(), va.Len())
    for i := 0; i < va.Len(); i++ {
        result.Index(i).Set(addValuesFloat64(va.Index(i), vb.Index(i)))
    }

    return result.Interface(), nil
}

func addValuesFloat64(a, b reflect.Value) (reflect.Value) {
    if a.Kind() == reflect.Slice {
        // Recursively add elements for nested slices
        resultInterface, err := addMatricesFloat64(a.Interface(), b.Interface())
        if err != nil {
            return reflect.Value{}
        }
        return reflect.ValueOf(resultInterface)
    } else {
        // Convert values to the common numeric type and add them
        return reflect.ValueOf(a.Float() + b.Float())
    }
}

func divideMatricesFloat64(a interface{}, b float64) (interface{}, error) {

	va := reflect.ValueOf(a)

	if va.Kind() != reflect.Slice {
		return nil, fmt.Errorf("matrix must be a slice")
	}

	result := reflect.MakeSlice(va.Type(), va.Len(), va.Len())
	for i := 0; i < va.Len(); i++ {
		result.Index(i).Set(divideValuesFloat64(va.Index(i), b))
	}

	return result.Interface(), nil
}

func divideValuesFloat64(a reflect.Value, b float64) reflect.Value {
	if a.Kind() == reflect.Slice {
		resultInterface, err := divideMatricesFloat64(a.Interface(), b)
		if err != nil {
			return reflect.Value{}
		}
		return reflect.ValueOf(resultInterface)
	} else {
		return reflect.ValueOf(a.Float() / b)
	}
}

func getFirstDimensionLength(matrix interface{}) int {
    value := reflect.ValueOf(matrix)

    if value.Kind() != reflect.Slice {
        return 0
    }
    return value.Len()
}

func GetCNFromClientID(clientID string) (string, error) {

	decodedBytes, err := base64.StdEncoding.DecodeString(clientID)
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
					Biases:  nil,
				},
			},
		},
		Tokens:    1, //initially giving everyone 1 tokens
		Round:     0,
		RoundSeen: []int{},
		Epsilon:   0,
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
	clientData.Epsilon = epsilon

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
		if (len(queryResponse.Key) >= 9 && queryResponse.Key[:9] == "appserver") {
			continue
		}
		clientList = append(clientList, queryResponse.Key)
	}

	// if less are there, send all
	if len(clientList) <= num {
		return clientList, nil
	}

	// shuffle the list
	rand.Shuffle(len(clientList), func(i, j int) { clientList[i], clientList[j] = clientList[j], clientList[i] })

	// select first num
	selectedClients := clientList[:num]

	return selectedClients, nil
}

// get data of random num clients
func (sc *SmartContract) GetRoundData(ctx contractapi.TransactionContextInterface, num int, seed int) (NeuralNetworkModel, error) {

	serverID, err := ctx.GetClientIdentity().GetID()
	if err != nil {
		return nil, fmt.Errorf("failed to get server ID: %v", err)
	}

	cn, err := GetCNFromClientID(serverID)
	if err != nil {
		return nil, fmt.Errorf("failed to get CN from server ID: %v", err)
	}

	serverDataAsBytes, err := ctx.GetStub().GetState(cn)
	if err != nil {
		return nil, fmt.Errorf("failed to read from world state: %v", err)
	}

	var serverData ClientData
	err = json.Unmarshal(serverDataAsBytes, &serverData)
	if err != nil {
		return nil, fmt.Errorf("failed to unmarshal server data: %v", err)
	}

	round := serverData.Round + 1
	fmt.Printf("Round: %v\n", round)
	selectedClients, err := SelectSubSet(ctx, num, seed)
	fmt.Printf("Selected clients length: %v\n", len(selectedClients))
	if err != nil {
		return nil, fmt.Errorf("failed to select subset: %v", err)
	}

	var clientModelData []NeuralNetworkModel

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

		if clientData.Round == round {
			clientModelData = append(clientModelData, clientData.Data)
			clientData.Tokens = clientData.Tokens + (clientData.Epsilon+5)/20.0
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

	if len(clientModelData) == 0 {
		return nil, fmt.Errorf("no data for round %v", round)
	}

	avgLayerWeights:= clientModelData[0]

	firstDim := getFirstDimensionLength(avgLayerWeights.Layers)

	for ind, clientModel := range clientModelData {
		if ind == 0 {
			continue
		}
		for i := 0; i < firstDim; i++ {
			avgLayerWeights.Layers[i].Weights, err = addMatricesFloat64(avgLayerWeights.Layers[i].Weights, clientModel.Layers[i].Weights)
			if err != nil {
				return nil, fmt.Errorf("failed to add matrices: %v", err)
			}
			avgLayerWeights.Layers[i].Biases, err = addMatricesFloat64(avgLayerWeights.Layers[i].Biases, clientModel.Layers[i].Biases)
			if err != nil {
				return nil, fmt.Errorf("failed to add matrices: %v", err)
			}
		}
	}

	for i := 0; i < firstDim; i++ {
		avgLayerWeights.Layers[i].Weights, err = divideMatricesFloat64(avgLayerWeights.Layers[i].Weights, float64(len(clientModelData)))
		if err != nil {
			return nil, fmt.Errorf("failed to divide matrices: %v", err)
		}
		avgLayerWeights.Layers[i].Biases, err = divideMatricesFloat64(avgLayerWeights.Layers[i].Biases, float64(len(clientModelData)))
		if err != nil {
			return nil, fmt.Errorf("failed to divide matrices: %v", err)
		}
	}

	serverData.Round = round
	serverData.Data = avgLayerWeights
	serverDataAsBytes, err = json.Marshal(serverData)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal server data: %v", err)
	}
	err = ctx.GetStub().PutState(cn, serverDataAsBytes)
	if err != nil {
		return nil, fmt.Errorf("failed to write to world state: %v", err)
	}

	return avgLayerWeights, nil
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
func (sc *SmartContract) GetResult(ctx contractapi.TransactionContextInterface, round int) (NeuralNetworkModel, error) {

	serverCN := "appserver"
	defaultReturn := NeuralNetworkModel{
		Layers: []Layer{},
	}

	clientID, err := ctx.GetClientIdentity().GetID()
	if err != nil {
		return defaultReturn, fmt.Errorf("failed to get client ID: %v", err)
	}

	clientData, err := getData(ctx, clientID)
	if err != nil {
		return defaultReturn, fmt.Errorf("failed to get client data: %v", err)
	}

	clientCN, err := GetCNFromClientID(clientID)
	if err != nil {
		return defaultReturn, fmt.Errorf("failed to get CN from client ID: %v", err)
	}

	serverDataAsBytes, err := ctx.GetStub().GetState(serverCN)
	if err != nil {
		return defaultReturn, fmt.Errorf("failed to read from world state: %v", err)
	}

	if serverDataAsBytes == nil {
		return defaultReturn, fmt.Errorf("the server data %s does not exist", serverCN)
	}

	var serverData ClientData
	err = json.Unmarshal(serverDataAsBytes, &serverData)
	if err != nil {
		return defaultReturn, fmt.Errorf("failed to unmarshal server data: %v", err)
	}

	if serverData.Round == 0 {
		return defaultReturn, fmt.Errorf("server %s has no data for round %v", serverCN, round)
	}

	// check if client has already seen the round
	for _, roundSeen := range clientData.RoundSeen {
		if roundSeen == round {
			fmt.Printf("Client %s has already seen round %v\n", clientCN, round)
			return serverData.Data, nil
		}
	}

	if clientData.Tokens < 1 {
		fmt.Printf("Client %s does not have sufficient tokens\n", clientCN)
		return defaultReturn, nil
	}

	clientData.RoundSeen = append(clientData.RoundSeen, round)
	clientData.Tokens = clientData.Tokens - 1 //consuming tokens from client

	fmt.Printf("Client %s got data for round %v\n", clientCN, clientData)
	clientDataAsBytes, err := json.Marshal(clientData)
	if err != nil {
		return defaultReturn, fmt.Errorf("failed to marshal client data: %v", err)
	}

	err = ctx.GetStub().PutState(clientCN, clientDataAsBytes)
	if err != nil {
		return defaultReturn, fmt.Errorf("failed to write to world state: %v", err)
	}

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
