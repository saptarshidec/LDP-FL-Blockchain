package main

import (
	// "encoding/base64"
	"math/rand"
	"encoding/json"
	"fmt"
	"github.com/hyperledger/fabric-contract-api-go/contractapi"
	// "reflect"
)

type Layer struct {
	Weights interface{} `json:"weights"`
	Biases  interface{} `json:"biases"`
}

type NeuralNetworkModel struct {
	Layers []Layer `json:"layers"`
}

// key = ORG_round_orgName_clientId, value = NeuralNetworkModel, epsilon
type OrgData struct {
	Data     NeuralNetworkModel `json:"data"`
	Epsilon  float64            `json:"epsilon"`
	OrgName string             `json:"orgName"`
}

// key = appserver_round, value = ServerData
type ServerData struct {
	Data string `json:"data"`
	Round int `json:"round"`
}

// key = orgname, value = {tokens, roundSeen}
type CurrentOrgData struct {
	Tokens      float64 `json:"tokens"`
	RoundSeen   []int   `json:"roundSeen"`
	LatestRound int     `json:"round"`
}

// key = KeyRequests, value = {orgName, round}
type KeyRequests struct {
	Round    []int    `json:"round"`
	OrgName []string `json:"orgName"`
}

// key = round, value = {password, iv}
type SessionKey struct {
	Password string `json:"password"`
	IV       string `json:"iv"`
}

type SmartContract struct {
	contractapi.Contract
}

func (s *SmartContract) InitLedger(ctx contractapi.TransactionContextInterface) error {

	orgName, err := ctx.GetClientIdentity().GetMSPID()
	if err != nil {
		return err
	}

	clientID, err := ctx.GetClientIdentity().GetID()
	if err != nil {
		return err
	}

	currentOrgData := CurrentOrgData{
		Tokens: 0,
		RoundSeen: []int{0},
		LatestRound: 0,
	}

	currentOrgDataJSON, err := json.Marshal(currentOrgData)
	if err != nil {
		return err
	}

	err = ctx.GetStub().PutState(orgName, currentOrgDataJSON)
	if err != nil {
		return err
	}

	if(orgName == "Org1MSP") {
		serverData := ServerData{
			Data: "",
			Round: 0,
		}

		serverDataJSON, err := json.Marshal(serverData)
		if err != nil {
			return err
		}

		err = ctx.GetStub().PutState("appserver_0", serverDataJSON)
		if err != nil {
			return err
		}

		keyRequests := KeyRequests{
			Round: []int{},
			OrgName: []string{},
		}

		keyRequestsJSON, err := json.Marshal(keyRequests)
		if err != nil {
			return err
		}

		err = ctx.GetStub().PutState("keyRequests", keyRequestsJSON)
		if err != nil {
			return err
		}

	} else {

		orgData := OrgData{
			Data: NeuralNetworkModel{},
			Epsilon: 0,
			OrgName: orgName,
		}

		orgDataJSON, err := json.Marshal(orgData)
		if err != nil {
			return err
		}

		compositeKey, err := ctx.GetStub().CreateCompositeKey("ORG_", []string{"0_", orgName, clientID})
		if err != nil {
			return err
		}

		err = ctx.GetStub().PutState(compositeKey, orgDataJSON)
		if err != nil {
			return err
		}
	}

	return nil
}

func getLatestRound(ctx contractapi.TransactionContextInterface, orgName string) (int, error) {

	currentOrgDataJSON, err := ctx.GetStub().GetState(orgName)
	if err != nil {
		return 0, err
	}

	if currentOrgDataJSON == nil {
		return 0, fmt.Errorf("the organization %s does not exist", orgName)
	}

	var currentOrgData CurrentOrgData
	err = json.Unmarshal(currentOrgDataJSON, &currentOrgData)
	if err != nil {
		return 0, err
	}

	return currentOrgData.LatestRound, nil
}

func (s *SmartContract) PutClientParams(ctx contractapi.TransactionContextInterface, data string, epsilon float64, round int) error {
	
	orgName, err := ctx.GetClientIdentity().GetMSPID()
	if err != nil {
		return err
	}

	clientID, err := ctx.GetClientIdentity().GetID()
	if err != nil {
		return err
	}

	serverLatestRound, err := getLatestRound(ctx, "Org1MSP")
	if err != nil {
		return err
	}

	roundNumber := round
	if serverLatestRound > roundNumber - 1 {
		roundNumber = serverLatestRound + 1
	}

	orgData := OrgData{
		Data: NeuralNetworkModel{},
		Epsilon: epsilon,
		OrgName: orgName,
	}

	err = json.Unmarshal([]byte(data), &orgData.Data)
	if err != nil {
		return err
	}

	orgDataJSON, err := json.Marshal(orgData)
	if err != nil {
		return err
	}


	compositeKey, err := ctx.GetStub().CreateCompositeKey("ORG_", []string{fmt.Sprintf("%d_", roundNumber), orgName, clientID})
	if err != nil {
		return err
	}

	err = ctx.GetStub().PutState(compositeKey, orgDataJSON)
	if err != nil {
		return err
	}

	currentOrgDataJSON, err := ctx.GetStub().GetState(orgName)
	if err != nil {
		return err
	}

	var currentOrgData CurrentOrgData
	err = json.Unmarshal(currentOrgDataJSON, &currentOrgData)
	if err != nil {
		return err
	}

	currentOrgData.LatestRound = roundNumber

	fmt.Printf("latest round: %d\n", currentOrgData.LatestRound)
	
	currentOrgDataJSON, err = json.Marshal(currentOrgData)
	if err != nil {
		return err
	}

	err = ctx.GetStub().PutState(orgName, currentOrgDataJSON)
	if err != nil {
		return err
	}

	return nil
}


func selectRandomSet(ctx contractapi.TransactionContextInterface, num int, seed int, round int) ([]string, error) {
	
	rand.Seed(int64(seed))

	keysIter, err := ctx.GetStub().GetStateByPartialCompositeKey("ORG_", []string{fmt.Sprintf("%d_", round)})
	if err != nil {
		return nil, err
	}

	defer keysIter.Close()
	

	clientList := []string{}
	for keysIter.HasNext() {
		keyResponse, err := keysIter.Next()
		if err != nil {
			return nil, err
		}
		clientList = append(clientList, keyResponse.Key)
	}

	if len(clientList) <= num {
		return clientList, nil
	}

	rand.Shuffle(len(clientList), func(i, j int) { clientList[i], clientList[j] = clientList[j], clientList[i] })
	return clientList[:num], nil
}

func (s *SmartContract) GetAllParams(ctx contractapi.TransactionContextInterface, num int, seed int) ([]NeuralNetworkModel, error) {

	orgName, err := ctx.GetClientIdentity().GetMSPID()
	if err != nil {
		return nil, err
	}

	latestRound, err := getLatestRound(ctx, orgName)
	if err != nil {
		return nil, err
	}

	nextRound := latestRound + 1

	clientList, err := selectRandomSet(ctx, num, seed, nextRound)
	if err != nil {
		return nil, err
	}

	fmt.Printf("selected clients: %v, round: %d\n", clientList, nextRound)

	neuralNetworkModels := []NeuralNetworkModel{}
	for _, client := range clientList {
		orgDataJSON, err := ctx.GetStub().GetState(client)
		if err != nil {
			return nil, err
		}

		var orgData OrgData
		err = json.Unmarshal(orgDataJSON, &orgData)
		if err != nil {
			return nil, err
		}

		currorgName := orgData.OrgName

		neuralNetworkModels = append(neuralNetworkModels, orgData.Data)

		fmt.Printf("client: %s, currorg: %s epsilon: %f\n", client, currorgName, orgData.Epsilon)

		currentOrgDataJSON, err := ctx.GetStub().GetState(currorgName)
		if err != nil {
			return nil, err
		}

		fmt.Printf("currentOrgDataJSON: %s\n", currentOrgDataJSON)

		var currentOrgData CurrentOrgData
		err = json.Unmarshal(currentOrgDataJSON, &currentOrgData)
		if err != nil {
			return nil, err
		}

		currentOrgData.Tokens += ((orgData.Epsilon+5)/20.0)

		fmt.Printf("tokens: %f, latestRound: %d\n", currentOrgData.Tokens, currentOrgData.LatestRound)

		currentOrgDataJSON, err = json.Marshal(currentOrgData)
		if err != nil {
			return nil, err
		}

		err = ctx.GetStub().PutState(currorgName, currentOrgDataJSON)
		if err != nil {
			return nil, err
		}
	}

	return neuralNetworkModels, nil
}

func (s *SmartContract) PutGlobalParams(ctx contractapi.TransactionContextInterface, data string) error {
	
	orgName, err := ctx.GetClientIdentity().GetMSPID()
	if err != nil {
		return err
	}

	fmt.Printf("executing PutGlobalParams for %s\n", orgName)

	if(orgName != "Org1MSP") {
		return fmt.Errorf("only the server can call this function")
	}

	fmt.Printf("Got latest Round for %s\n", orgName)

	latestRound, err := getLatestRound(ctx, orgName)
	if err != nil {
		return err
	}

	newround := latestRound + 1

	serverData := ServerData{
		Data: data,
		Round: newround,
	}

	fmt.Printf("Latest round: %d\n", newround)

	serverDataJSON, err := json.Marshal(serverData)
	if err != nil {
		return err
	}

	err = ctx.GetStub().PutState("appserver_" + fmt.Sprintf("%d", newround), serverDataJSON)
	if err != nil {
		return err
	}

	currentData := CurrentOrgData{
		Tokens: 0,
		RoundSeen: []int{newround},
		LatestRound: newround,
	}

	currentDataJSON, err := json.Marshal(currentData)
	if err != nil {
		return err
	}

	err = ctx.GetStub().PutState("Org1MSP", currentDataJSON)
	if err != nil {
		return err
	}

	fmt.Printf("Put data for round %d\n", newround)

	return nil
}

func (s *SmartContract) GetEncryptedParams(ctx contractapi.TransactionContextInterface, round int) (string, error) {
	
	serverDataJSON, err := ctx.GetStub().GetState("appserver_" + fmt.Sprintf("%d", round))
	if err != nil {
		return "", err
	}

	if serverDataJSON == nil {
		return "", fmt.Errorf("the server data for round %d does not exist", round)
	}

	var serverData ServerData
	err = json.Unmarshal(serverDataJSON, &serverData)
	if err != nil {
		return "", err
	}

	fmt.Printf("round: %d, len data: %d\n", serverData.Round, len(serverData.Data))

	return serverData.Data, nil
}

func (s *SmartContract) RequestParams(ctx contractapi.TransactionContextInterface, round int) error {
	
	orgName, err := ctx.GetClientIdentity().GetMSPID()
	if err != nil {
		return err
	}

	keyRequestsJSON, err := ctx.GetStub().GetState("keyRequests")
	if err != nil {
		return err
	}

	var keyRequests KeyRequests
	err = json.Unmarshal(keyRequestsJSON, &keyRequests)
	if err != nil {
		return err
	}

	for i, r := range keyRequests.Round {
		if r == round && keyRequests.OrgName[i] == orgName {
			return nil
		}
	}

	currentOrgDataJSON, err := ctx.GetStub().GetState(orgName)
	if err != nil {
		return err
	}

	var currentOrgData CurrentOrgData
	err = json.Unmarshal(currentOrgDataJSON, &currentOrgData)
	if err != nil {
		return err
	}

	seen := false
	for _, r := range currentOrgData.RoundSeen {
		if r == round {
			seen = true
			break
		}
	}

	if !seen {
		if currentOrgData.Tokens < 1 {
			return fmt.Errorf("the organization %s does not have enough tokens", orgName)
		}

		currentOrgData.Tokens -= 1
		currentOrgData.RoundSeen = append(currentOrgData.RoundSeen, round)
		
		currentOrgDataJSON, err = json.Marshal(currentOrgData)
		if err != nil {
			return err
		}

		err = ctx.GetStub().PutState(orgName, currentOrgDataJSON)
		if err != nil {
			return err
		}
	}

	keyRequests.Round = append(keyRequests.Round, round)
	keyRequests.OrgName = append(keyRequests.OrgName, orgName)

	keyRequestsJSON, err = json.Marshal(keyRequests)
	if err != nil {
		return err
	}

	err = ctx.GetStub().PutState("keyRequests", keyRequestsJSON)
	if err != nil {
		return err
	}

	return nil
}

func (s *SmartContract) GetRequests(ctx contractapi.TransactionContextInterface) (KeyRequests, error) {
	
	keyRequestsJSON, err := ctx.GetStub().GetState("keyRequests")
	if err != nil {
		return KeyRequests{}, err
	}

	if keyRequestsJSON == nil {
		return KeyRequests{}, fmt.Errorf("the key requests do not exist")
	}

	var keyRequests KeyRequests
	err = json.Unmarshal(keyRequestsJSON, &keyRequests)
	if err != nil {
		return KeyRequests{}, err
	}

	var newKeyRequests KeyRequests = KeyRequests{
		Round: []int{},
		OrgName: []string{},
	}

	keyRequestsJSON, err = json.Marshal(newKeyRequests)
	if err != nil {
		return KeyRequests{}, err
	}

	err = ctx.GetStub().PutState("keyRequests", keyRequestsJSON)
	if err != nil {
		return KeyRequests{}, err
	}

	return keyRequests, nil
}

func (s* SmartContract) PutSessionKey(ctx contractapi.TransactionContextInterface, round int, privateDataCollection string) error {

	transientMap, err := ctx.GetStub().GetTransient()

	if err != nil {
		return fmt.Errorf("failed to get transient field: %v", err)
	}

	password := transientMap["password"]
	iv := transientMap["iv"]

	fmt.Printf("password: %s, iv: %s, round: %d, privateDataCollection: %s\n", password, iv, round, privateDataCollection)

	sessionKey := SessionKey{
		Password: string(password),
		IV: string(iv),
	}

	sessionKeyJSON, err := json.Marshal(sessionKey)
	if err != nil {
		return err
	}

	err = ctx.GetStub().PutPrivateData(privateDataCollection, fmt.Sprintf("%d", round), sessionKeyJSON)
	if err != nil {
		return err
	}

	return nil
}

func (s* SmartContract) GetSessionKey(ctx contractapi.TransactionContextInterface, round int, privateDataCollection string) (SessionKey, error) {

	sessionKeyJSON, err := ctx.GetStub().GetPrivateData(privateDataCollection, fmt.Sprintf("%d", round))
	if err != nil {
		return SessionKey{}, err
	}

	if sessionKeyJSON == nil {
		return SessionKey{}, fmt.Errorf("the session key for round %d does not exist", round)
	}

	sessionKey := SessionKey{}
	err = json.Unmarshal(sessionKeyJSON, &sessionKey)
	if err != nil {
		return SessionKey{}, err
	}

	return sessionKey, nil
}

func main() {

	chaincode, err := contractapi.NewChaincode(new(SmartContract))

	if err != nil {
		fmt.Printf("Error create chaincode: %s", err.Error())
		return
	}

	err = chaincode.Start()

	if err != nil {
		fmt.Printf("Error starting chaincode: %s", err.Error())
	}

}