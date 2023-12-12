package main

import (
	"encoding/base64"
	"encoding/json"
	"fmt"

	"github.com/hyperledger/fabric-contract-api-go/contractapi"
)

type ClientData struct {
    ClientID string `json:"clientID"`
    Data     string `json:"data"`
    Round  int    `json:"round"`
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
		Data:     "",
		Round: 0,
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

func (sc *SmartContract) PutData(ctx contractapi.TransactionContextInterface, data string) error {
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

	clientData.Round = clientData.Round + 1
	clientData.Data = data
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

func (sc *SmartContract) GetRoundData(ctx contractapi.TransactionContextInterface, round int) ([]ClientData, error) {
	var clientDataList []ClientData

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

		clientDataAsBytes, err := ctx.GetStub().GetState(queryResponse.Key)
		if err != nil {
			return nil, fmt.Errorf("failed to read from world state: %v", err)
		}

		var clientData ClientData
		err = json.Unmarshal(clientDataAsBytes, &clientData)
		if err != nil {
			return nil, fmt.Errorf("failed to unmarshal client data: %v", err)
		}

		if clientData.Round == round {
			clientDataList = append(clientDataList, clientData)
		}

	}
	fmt.Printf("clientDataList: %v", clientDataList)
	return clientDataList, nil
}

func (sc *SmartContract) GetData(ctx contractapi.TransactionContextInterface) (string, error) {

	clientID, err := ctx.GetClientIdentity().GetID()
	if err != nil {
		return "", fmt.Errorf("failed to get client ID: %v", err)
	}

	cn, err := GetCNFromClientID(clientID)
	if err != nil {
		return "", fmt.Errorf("failed to get CN from client ID: %v", err)
	}

	clientDataAsBytes, err := ctx.GetStub().GetState(cn)
	if err != nil {
		return "", fmt.Errorf("failed to read from world state: %v", err)
	}

	if clientDataAsBytes == nil {
		return "", fmt.Errorf("the client data %s does not exist", clientID)
	}

	var clientData ClientData
	err = json.Unmarshal(clientDataAsBytes, &clientData)
	if err != nil {
		return "", fmt.Errorf("failed to unmarshal client data: %v", err)
	}

	return clientData.Data, nil
}

func (sc *SmartContract) GetResult(ctx contractapi.TransactionContextInterface, cn string) (string, error) {
	
	clientDataAsBytes, err := ctx.GetStub().GetState(cn)
	if err != nil {
		return "", fmt.Errorf("failed to read from world state: %v", err)
	}

	if clientDataAsBytes == nil {
		return "", fmt.Errorf("the client data %s does not exist", cn)
	}

	var clientData ClientData
	err = json.Unmarshal(clientDataAsBytes, &clientData)
	if err != nil {
		return "", fmt.Errorf("failed to unmarshal client data: %v", err)
	}

	return clientData.Data, nil
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

