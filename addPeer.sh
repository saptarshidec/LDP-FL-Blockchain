./network.sh down
docker container prune -f
docker image prune -f
docker network prune -f
docker volume prune -f
sleep 2
./network.sh up createChannel -ca
export CORE_PEER_TLS_ENABLED=true
export CORE_PEER_LOCALMSPID="Org1MSP"
export CORE_PEER_TLS_ROOTCERT_FILE=${PWD}/organizations/peerOrganizations/org1.example.com/peers/peer0.org1.example.com/tls/ca.crt
export CORE_PEER_MSPCONFIGPATH=${PWD}/organizations/peerOrganizations/org1.example.com/users/Admin@org1.example.com/msp
export CORE_PEER_ADDRESS=localhost:7051
export PATH=$PATH:$PWD/../bin/
export FABRIC_CFG_PATH=$PWD/../config/
export ORDERER_CA=${PWD}/organizations/ordererOrganizations/example.com/orderers/orderer.example.com/msp/tlscacerts/tlsca.example.com-cert.pem
./network.sh deployCC -ccn rounds3 -ccp ./my_chaincodes/v5_rounds -ccl go
export PATH=$PATH:${PWD}/../bin
export FABRIC_CA_CLIENT_HOME=${PWD}/organizations/peerOrganizations/org1.example.com/
fabric-ca-client register --caname ca-org1 --id.name peer1 --id.secret peer1pw --id.type peer --tls.certfiles ${PWD}/organizations/fabric-ca/org1/tls-cert.pem
mkdir -p organizations/peerOrganizations/org1.example.com/peers/peer1.org1.example.com
fabric-ca-client enroll -u https://peer1:peer1pw@localhost:7054 --caname ca-org1 -M ${PWD}/organizations/peerOrganizations/org1.example.com/peers/peer1.org1.example.com/msp --csr.hosts peer1.org1.example.com --tls.certfiles ${PWD}/organizations/fabric-ca/org1/tls-cert.pem
cp ${PWD}/organizations/peerOrganizations/org1.example.com/msp/config.yaml ${PWD}/organizations/peerOrganizations/org1.example.com/peers/peer1.org1.example.com/msp/config.yaml
fabric-ca-client enroll -u https://peer1:peer1pw@localhost:7054 --caname ca-org1 -M ${PWD}/organizations/peerOrganizations/org1.example.com/peers/peer1.org1.example.com/tls --enrollment.profile tls --csr.hosts peer1.org1.example.com --csr.hosts localhost --tls.certfiles ${PWD}/organizations/fabric-ca/org1/tls-cert.pem
cp ${PWD}/organizations/peerOrganizations/org1.example.com/peers/peer1.org1.example.com/tls/tlscacerts/* ${PWD}/organizations/peerOrganizations/org1.example.com/peers/peer1.org1.example.com/tls/ca.crt
cp ${PWD}/organizations/peerOrganizations/org1.example.com/peers/peer1.org1.example.com/tls/signcerts/* ${PWD}/organizations/peerOrganizations/org1.example.com/peers/peer1.org1.example.com/tls/server.crt
cp ${PWD}/organizations/peerOrganizations/org1.example.com/peers/peer1.org1.example.com/tls/keystore/* ${PWD}/organizations/peerOrganizations/org1.example.com/peers/peer1.org1.example.com/tls/server.key
ls -l organizations/peerOrganizations/org1.example.com/peers/peer1.org1.example.com/
ls -l organizations/peerOrganizations/org1.example.com/peers/peer1.org1.example.com/msp/
ls -l organizations/peerOrganizations/org1.example.com/peers/peer1.org1.example.com/tls/
docker-compose -f ./compose/docker/docker-compose-peer1org1.yaml up -d
peer channel list
sleep 2
CORE_PEER_ADDRESS=localhost:8051 peer channel list
CORE_PEER_ADDRESS=localhost:8051 peer channel join -b channel-artifacts/mychannel.block
CORE_PEER_ADDRESS=localhost:8051 peer channel list
CORE_PEER_ADDRESS=localhost:8051 peer lifecycle chaincode install rounds3.tar.gz 
CORE_PEER_ADDRESS=localhost:8051 peer channel getinfo -c mychannel
CORE_PEER_ADDRESS=localhost:7051 peer channel getinfo -c mychannel