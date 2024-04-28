package main

import (
	"fmt"

	"github.com/hyperledger/fabric-contract-api-go/contractapi"
)

type MyChaincode struct {
	contractapi.Contract
}

func (cc *MyChaincode) PutPrivateData(ctx contractapi.TransactionContextInterface, collection, key, value string) error {
	err := ctx.GetStub().PutPrivateData(collection, key, []byte(value))
	if err != nil {
		return fmt.Errorf("failed to put private data: %v", err)
	}
	return nil
}

func (cc *MyChaincode) GetPrivateData(ctx contractapi.TransactionContextInterface, collection, key string) (string, error) {
	value, err := ctx.GetStub().GetPrivateData(collection, key)
	if err != nil {
		return "", fmt.Errorf("failed to get private data: %v", err)
	}
	if value == nil {
		return "", fmt.Errorf("data not found")
	}
	return string(value), nil
}

func main() {
	chaincode, err := contractapi.NewChaincode(&MyChaincode{})
	if err != nil {
		fmt.Printf("Error creating chaincode: %v", err)
		return
	}

	if err := chaincode.Start(); err != nil {
		fmt.Printf("Error starting chaincode: %v", err)
	}
}