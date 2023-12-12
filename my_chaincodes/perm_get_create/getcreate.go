package main

import (
	"fmt"
	"github.com/hyperledger/fabric-contract-api-go/contractapi"
)

// SmartContract
type SmartContract struct {
	contractapi.Contract
}

// InitLedger
func (s *SmartContract) InitLedger(ctx contractapi.TransactionContextInterface) error {
	err := ctx.GetStub().PutState("testkey", []byte("testvalue"))

	if err != nil {
		return fmt.Errorf("failed to put to world state. %v", err)
	}

	return nil
}

// CreateKey
func (s *SmartContract) CreateKey(ctx contractapi.TransactionContextInterface, key string, value string) error {
	
	return ctx.GetStub().PutState(key, []byte(value))
}

// QueryKey
func (s *SmartContract) QueryKey(ctx contractapi.TransactionContextInterface, key string) (string, error) {

	value, err := ctx.GetStub().GetState(key)

	if err != nil {
		return "", fmt.Errorf("failed to read from world state. %v", err)
	}

	if value == nil {
		return "", fmt.Errorf("%s does not exist", key)
	}

	return string(value), nil
}

func main(){

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