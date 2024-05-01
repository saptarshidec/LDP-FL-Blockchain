const FabricCAServices = require('fabric-ca-client');
const { Gateway, Wallets } = require('fabric-network');
const fs = require('fs')
const path = require('path')
const tf = require('@tensorflow/tfjs-node');
const mnist = require('mnist');
const cifar10 = require('cifar10')({ dataPath: './data' })
const fashionmnist = require('fashion-mnist');
const crypto = require('crypto');
const {randomInt} = require('crypto')

// 4 orgs in total, 1st org is server's and rest are clients
let nclients = 7 // (client0 is server, rest are actual clients)
let num_clients_per_org = 2
let nepochs = 10
let images_per_class = 30
let test_images_per_class = 15

const algorithm = 'aes-192-cbc';
let sessionKey = {}  // sessionKey[round] = {password, iv}

let userNames = ["appserver", "appuser1", "appuser2", "appuser3", "appuser4", "appuser5", "appuser6", "appuser7", "appuser8", "appuser9", "appuser10"]
let orgNames = ["org1", "org2", "org3", "org4", "org2", "org3", "org4"]
let orgMSP_to_orgName = {
    "Org1MSP": "org1",
    "Org2MSP": "org2",
    "Org3MSP": "org3",
    "Org4MSP": "org4"
}
let privateDataCollection = {
    "org1": "Org2_Server_Collection",
    "org2": "Org2_Server_Collection",
    "org3": "Org3_Server_Collection",
    "org4": "Org4_Server_Collection"
}

let contract = [null, null, null, null, null, null, null, null, null, null, null]
let gateways = [null, null, null, null, null, null, null, null, null, null, null]
let models = [null, null, null, null, null, null, null, null, null, null, null]
let epsilonArray = [8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8]

const generateRandomArray = (length, min, max) =>
  Array.from({ length }, () => Math.floor(Math.random() * (max - min + 1)) + min);

// Example usage:
const length = 11; // length of the array
const min = 4;     // minimum value
const max = 12;   // maximum value

// let epsilonArray=generateRandomArray(length,min,max)
// const randomArray = generateRandomArray(length, min, max);

let dataseed = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]


function LDP_FL(weight, c = 0.0, r = 0.075, eps = 1) {

    var rand_val = Math.random();

    if (weight > 0.15) {
        weight = 0.15
    }
    else if (weight < -0.15) {
        weight = -0.15
    }
    var boundary = (r * (Math.exp(eps) + 1) + (weight - c) * (Math.exp(eps) - 1)) / (2 * r * (Math.exp(eps) + 1));

    if (rand_val <= boundary) {
        return c + r * ((Math.exp(eps) + 1) / (Math.exp(eps) - 1));
    }
    else {
        return c - r * ((Math.exp(eps) + 1) / (Math.exp(eps) - 1));
    }
}

function perturbWeights(weightTensor, c = 0, r = 0.15, eps = 1) {
    const weightValues = weightTensor.dataSync();
    const processedWeightValues = weightValues.map(val => LDP_FL(val, c, r, eps));
    const newWeightTensor = tf.tensor(processedWeightValues, weightTensor.shape);
    return newWeightTensor;
}

class DatasetModel {
    constructor(seed = 0, epsilon = 0, nepochs = 0) {
        this.model = null;
        this.dataset = null;
        this.testset = null;
        this.seed = seed;
        this.epsilon = epsilon;
        this.nepochs = nepochs;
    }

    async initModel() { }

    async preprocessDataset() { }

    async trainModelAndPerturbWeights(epsilon) { }

    async testModel() { }

    async setWeights(weights) { }

    async weights_ldp(epsilon) {
        let perturbedWeightsArray = tf.tidy(() => {
            let perturbedWeightsArray = [];
            for (const layer of this.model.layers) {
                const weights = layer.getWeights();
                for (const weight of weights) {
                    const perturbedWeight = perturbWeights(tf.clone(weight), 0, 0.15, epsilon);
                    perturbedWeightsArray.push(tf.clone(perturbedWeight).arraySync());
                }
            }
            return perturbedWeightsArray;
        });

        return perturbedWeightsArray;
    }

    async formatWeights() {
        let modelData = {
            "layers": []
        }
        let weights = this.model.getWeights();
        for (let i = 0; i < weights.length; i += 2) {
            let layer = {
                "weights": weights[i].arraySync(),
                "biases": weights[i + 1].arraySync()
            }
            modelData.layers.push(layer);
        }

        return modelData;
    }
}

class MNISTModel extends DatasetModel {
    constructor(seed = 0, epsilon = 0, nepochs = 0) {
        super(seed, epsilon, nepochs);
        this.prevModelWeights = null;
    }

    async initModel() {

        this.model = tf.sequential();

        this.model.add(tf.layers.conv2d({
            inputShape: [28, 28, 1], 
            filters: 16,
            kernelSize: 3,
            activation: 'relu',
            kernelInitializer: 'randomNormal'
        }));

        this.model.add(tf.layers.maxPooling2d({ poolSize: [2, 2] }));

        this.model.add(tf.layers.conv2d({
            filters: 32,
            kernelSize: 3,
            activation: 'relu',
            kernelInitializer: 'randomNormal'
        }));

        this.model.add(tf.layers.maxPooling2d({ poolSize: [2, 2] }));

        this.model.add(tf.layers.flatten());

        this.model.add(tf.layers.dense({
            units: 128,
            activation: 'relu',
            kernelInitializer: 'randomNormal'
        }));

        this.model.add(tf.layers.dense({
            units: 10,
            activation: 'softmax',
            kernelInitializer: 'randomNormal'
        }));

        this.model.compile({
            optimizer: 'adam',
            loss: 'categoricalCrossentropy',
            metrics: ['accuracy']
        });

        console.log("Model initialized");
    }

    async preprocessDataset() {
        this.dataset = { inputs: [], outputs: [] };
        this.testset = { inputs: [], outputs: [] };
        console.log("Seed: " + this.seed);
        for (let i = 0; i < 10; ++i) {
            let set = mnist[i].set(this.seed, this.seed + images_per_class - 1);
            for (let j = 0; j < images_per_class; ++j) {
                let ip = set[j].input;
                let op = set[j].output;
                this.dataset.inputs = this.dataset.inputs.concat(ip);
                this.dataset.outputs = this.dataset.outputs.concat(op);
            }
        }
        for (let i = 0; i < 10; ++i) {
            let set = mnist[i].set(this.seed + images_per_class, this.seed + images_per_class + test_images_per_class - 1);
            for (let j = 0; j < test_images_per_class; ++j) {
                let ip = set[j].input;
                let op = set[j].output;
                this.testset.inputs = this.testset.inputs.concat(ip);
                this.testset.outputs = this.testset.outputs.concat(op);
            }
        }

        this.dataset.inputs = tf.tensor4d(this.dataset.inputs, [this.dataset.inputs.length / 784, 28, 28, 1]);
        this.dataset.outputs = tf.tensor2d(this.dataset.outputs, [this.dataset.outputs.length / 10, 10]);

        this.testset.inputs = tf.tensor4d(this.testset.inputs, [this.testset.inputs.length / 784, 28, 28, 1]);
        this.testset.outputs = tf.tensor2d(this.testset.outputs, [this.testset.outputs.length / 10, 10]);
    }

    async trainModelAndPerturbWeights(epsilon) {

        await this.model.fit(this.dataset.inputs, this.dataset.outputs, {
            epochs: nepochs,
            verbose: 0,
        });

        return await this.weights_ldp(epsilon);
    }

    async testModel() {

        const predictions = this.model.predict(this.testset.inputs);
        const predictionsArray = predictions.arraySync();
        const yTestArray = this.testset.outputs.arraySync();

        let correct = 0;
        for (let i = 0; i < predictionsArray.length; ++i) {
            const predictedLabel = predictionsArray[i].indexOf(Math.max(...predictionsArray[i]));
            const actualLabel = yTestArray[i].indexOf(Math.max(...yTestArray[i]));
            if (predictedLabel === actualLabel) {
                correct++;
            }
        }

        const accuracy = correct / (predictionsArray.length);

        console.log("Client accuracy: " + accuracy);
        return accuracy;
    }

    async setWeights(weights) {
        this.model.setWeights([
            tf.tensor4d(weights[0].weights),
            tf.tensor1d(weights[0].biases),
            tf.tensor4d(weights[1].weights),
            tf.tensor1d(weights[1].biases),
            tf.tensor2d(weights[2].weights),
            tf.tensor1d(weights[2].biases),
            tf.tensor2d(weights[3].weights),
            tf.tensor1d(weights[3].biases)
        ])
    }
}

class CIFARModel extends DatasetModel {
    constructor(seed = 0, epsilon = 0, nepochs = 0) {
        super(seed, epsilon, nepochs);
    }

    async initModel() {

        this.model = tf.sequential();

        this.model.add(tf.layers.conv2d({
            inputShape: [32, 32, 3], // CIFAR-10 images are 32x32 pixels and have three channels (RGB)
            filters: 16,
            kernelSize: 3,
            activation: 'relu',
            kernelInitializer: 'randomNormal'
        }));

        this.model.add(tf.layers.maxPooling2d({ poolSize: [2, 2] }));

        this.model.add(tf.layers.conv2d({
            filters: 32,
            kernelSize: 3,
            activation: 'relu',
            kernelInitializer: 'randomNormal'
        }));

        this.model.add(tf.layers.maxPooling2d({ poolSize: [2, 2] }));

        this.model.add(tf.layers.flatten());

        this.model.add(tf.layers.dense({
            units: 128,
            activation: 'relu',
            kernelInitializer: 'randomNormal'
        }));

        this.model.add(tf.layers.dense({
            units: 10, // Number of classes in CIFAR-10
            activation: 'softmax',
            kernelInitializer: 'randomNormal'
        }));

        this.model.compile({
            optimizer: 'adam',
            loss: 'categoricalCrossentropy',
            metrics: ['accuracy']
        });

        console.log("Model initialized");
    }

    async preprocessDataset() {
        this.dataset = { inputs: [], outputs: [] };
        this.testset = { inputs: [], outputs: [] };
        let training_data = await cifar10.training.get(images_per_class * 10);
        let test_data = await cifar10.test.get(test_images_per_class * 10);
        for (let j = 0; j < images_per_class * 10; ++j) {
            this.dataset.inputs = this.dataset.inputs.concat(training_data[j].input);
            this.dataset.outputs = this.dataset.outputs.concat(training_data[j].output);
        }

        for (let j = 0; j < test_images_per_class * 10; ++j) {
            this.testset.inputs = this.testset.inputs.concat(test_data[j].input);
            this.testset.outputs = this.testset.outputs.concat(test_data[j].output);
        }

        this.dataset.inputs = tf.tensor4d(this.dataset.inputs, [this.dataset.inputs.length / 3072, 32, 32, 3]);
        this.dataset.outputs = tf.tensor2d(this.dataset.outputs, [this.dataset.outputs.length / 10, 10]);

        this.testset.inputs = tf.tensor4d(this.testset.inputs, [this.testset.inputs.length / 3072, 32, 32, 3]);
        this.testset.outputs = tf.tensor2d(this.testset.outputs, [this.testset.outputs.length / 10, 10]);
    }

    async trainModelAndPerturbWeights(epsilon) {
        await this.model.fit(this.dataset.inputs, this.dataset.outputs, {
            epochs: nepochs,
            verbose: 0,
        })

        return await this.weights_ldp(epsilon);
    }

    async testModel() {
        const predictions = this.model.predict(this.testset.inputs);
        const predictionsArray = predictions.arraySync();
        const yTestArray = this.testset.outputs.arraySync();

        let correct = 0;
        for (let i = 0; i < predictionsArray.length; ++i) {
            const predictedLabel = predictionsArray[i].indexOf(Math.max(...predictionsArray[i]));
            const actualLabel = yTestArray[i].indexOf(Math.max(...yTestArray[i]));
            if (predictedLabel === actualLabel) {
                correct++;
            }
        }

        const accuracy = correct / (predictionsArray.length);

        console.log("Client accuracy: " + accuracy);
        return accuracy;
    }

    async setWeights(weights) {
        this.model.setWeights([
            tf.tensor4d(weights[0].weights),
            tf.tensor1d(weights[0].biases),
            tf.tensor4d(weights[1].weights),
            tf.tensor1d(weights[1].biases),
            tf.tensor2d(weights[2].weights),
            tf.tensor1d(weights[2].biases),
            tf.tensor2d(weights[3].weights),
            tf.tensor1d(weights[3].biases)
        ])
          
    }
}

class FashionMNIST extends DatasetModel {

    async initModel() {

        this.model = tf.sequential();

        this.model.add(tf.layers.conv2d({
            inputShape: [28, 28, 1], 
            filters: 16,
            kernelSize: 3,
            activation: 'relu',
            kernelInitializer: 'randomNormal'
        }));

        this.model.add(tf.layers.maxPooling2d({ poolSize: [2, 2] }));

        this.model.add(tf.layers.conv2d({
            filters: 32,
            kernelSize: 3,
            activation: 'relu',
            kernelInitializer: 'randomNormal'
        }));

        this.model.add(tf.layers.maxPooling2d({ poolSize: [2, 2] }));

        this.model.add(tf.layers.flatten());

        this.model.add(tf.layers.dense({
            units: 128,
            activation: 'relu',
            kernelInitializer: 'randomNormal'
        }));

        this.model.add(tf.layers.dense({
            units: 10,
            activation: 'softmax',
            kernelInitializer: 'randomNormal'
        }));

        this.model.compile({
            optimizer: 'adam',
            loss: 'categoricalCrossentropy',
            metrics: ['accuracy']
        });

        console.log("Model initialized");
    }

    async preprocessDataset() {
        this.dataset = { inputs: [], outputs: [] };
        this.testset = { inputs: [], outputs: [] };
        console.log("Seed: " + this.seed);
        for (let i = 0; i < 10; ++i) {
            let set = fashionmnist[i].set(this.seed, this.seed + images_per_class - 1);
            for (let j = 0; j < images_per_class; ++j) {
                let ip = set[j].input;
                let op = set[j].output;
                this.dataset.inputs = this.dataset.inputs.concat(ip);
                this.dataset.outputs = this.dataset.outputs.concat(op);
            }
        }
        for (let i = 0; i < 10; ++i) {
            let set = fashionmnist[i].set(this.seed + images_per_class, this.seed + images_per_class + test_images_per_class - 1);
            for (let j = 0; j < test_images_per_class; ++j) {
                let ip = set[j].input;
                let op = set[j].output;
                this.testset.inputs = this.testset.inputs.concat(ip);
                this.testset.outputs = this.testset.outputs.concat(op);
            }
        }
    }

    async trainModelAndPerturbWeights(epsilon) {
        const xTrain = tf.tensor4d(this.dataset.inputs, [this.dataset.inputs.length / 784, 28, 28, 1]);
        const yTrain = tf.tensor2d(this.dataset.outputs, [this.dataset.outputs.length / 10, 10]);

        await this.model.fit(xTrain, yTrain, {
            epochs: nepochs,
            verbose: 0,
        });

        return await this.weights_ldp(epsilon);
    }

    async testModel() {
        const xTest = tf.tensor4d(this.testset.inputs, [this.testset.inputs.length / 784, 28, 28, 1]);
        const yTest = tf.tensor2d(this.testset.outputs, [this.testset.outputs.length / 10, 10]);

        const predictions = this.model.predict(xTest);
        const predictionsArray = predictions.arraySync();
        const yTestArray = yTest.arraySync();

        let correct = 0;
        for (let i = 0; i < predictionsArray.length; ++i) {
            const predictedLabel = predictionsArray[i].indexOf(Math.max(...predictionsArray[i]));
            const actualLabel = yTestArray[i].indexOf(Math.max(...yTestArray[i]));
            if (predictedLabel === actualLabel) {
                correct++;
            }
        }

        const accuracy = correct / (predictionsArray.length);

        console.log("Client accuracy: " + accuracy);
        return accuracy;
    }

    async setWeights(weights) {
        this.model.setWeights([
            tf.tensor4d(weights[0].weights),
            tf.tensor1d(weights[0].biases),
            tf.tensor4d(weights[1].weights),
            tf.tensor1d(weights[1].biases),
            tf.tensor2d(weights[2].weights),
            tf.tensor1d(weights[2].biases),
            tf.tensor2d(weights[3].weights),
            tf.tensor1d(weights[3].biases)
        ])
    }
}

const initClient = async(clientInd) => {

    const orgName = orgNames[clientInd];
    const userName = userNames[clientInd];
    try{

        const chainCode = "basic";
        const ccpPath = path.resolve(`../../test-network/organizations/peerOrganizations/${orgName}.example.com/connection-${orgName}.json`);        const ccpJSON = fs.readFileSync(ccpPath, 'utf8');
        const ccp = JSON.parse(ccpJSON);

        const caInfo = ccp.certificateAuthorities[`ca.${orgName}.example.com`];
        const caTLSCACerts = caInfo.tlsCACerts.pem;
        const ca = new FabricCAServices(caInfo.url, { trustedRoots: caTLSCACerts, verify: false }, caInfo.caName);

        const walletPath = path.join(process.cwd(), 'wallet');
        const wallet = await Wallets.newFileSystemWallet(walletPath);

        const enrollment = await ca.enroll({
            enrollmentID: 'admin',
            enrollmentSecret: 'adminpw'
        });

        const orgMSP = `${orgName.charAt(0).toUpperCase() + orgName.slice(1)}MSP`;

        const x509Identity = {
            credentials: {
                certificate: enrollment.certificate,
                privateKey: enrollment.key.toBytes()
            },
            mspId: orgMSP,
            type: 'X.509'
        };

        await wallet.put(`admin${orgName}`, x509Identity);
        console.log(`Successfully enrolled admin user admin${orgName} and imported it into the wallet`);

        const adminIdentity = await wallet.get(`admin${orgName}`);
        const provider = wallet.getProviderRegistry().getProvider(adminIdentity.type);

        const adminUser = await provider.getUserContext(adminIdentity, `admin${orgName}`);

        const getUser = await wallet.get(userName);
        if (getUser) {
            console.log(`An identity for the user ${userName} already exists in the wallet`);
        }
        else{
            const secret = await ca.register({
                affiliation: `${orgName}.department1`,
                enrollmentID: userName,
                role: 'client'
            }, adminUser);

            const enrollment2 = await ca.enroll({
                enrollmentID: userName,
                enrollmentSecret: secret
            });

            const x509Identity2 = {
                credentials: {
                    certificate: enrollment2.certificate,
                    privateKey: enrollment2.key.toBytes()
                },
                mspId: orgMSP,
                type: 'X.509'
            };

            await wallet.put(userName, x509Identity2);
            console.log(`Successfully enrolled user ${userName} and imported it into the wallet`);
        }
        const gateway = new Gateway();
        await gateway.connect(ccp, { wallet, identity: userName, discovery: { enabled: true, asLocalhost: true } });

        const network = await gateway.getNetwork('mychannel');
        contract[clientInd] = network.getContract(chainCode);
        gateways[clientInd] = gateway;

        if(!getUser) await contract[clientInd].submitTransaction('InitLedger');
        console.log("Gateway connected for user " + userName);
    }
    catch(err){
        console.log(err)
    }
}

const trainModelAndPushParams = async (clientInd, round, epsilon) => {

    try {
        let modelData = await models[clientInd].trainModelAndPerturbWeights(epsilon);
        modelData = await models[clientInd].formatWeights();
        const modelDataString = JSON.stringify(modelData);
        const transaction = contract[clientInd].createTransaction('PutClientParams');
        transaction.setEndorsingOrganizations('Org1MSP', 'Org2MSP');
        await transaction.submit(modelDataString, epsilon,round);
        console.log("Client " + clientInd + " trained and sent weights");
    }
    catch (error) {
        console.log("TrainModelAndPushParams " + "Client ID: " + clientInd + " " + error);
    }
}

const getParamsAndPutGlobals = async (round) => {

    try{
        let num = nclients - 1;
        let seed = randomInt(1000);
        const transaction = contract[0].createTransaction('GetAllParams');
        console.log("Transaction: GetAllParams")
        transaction.setEndorsingOrganizations('Org1MSP', 'Org2MSP');
        let clientWeights = await transaction.submit(num, seed);
        console.log("Received weights from clients and averaged");
        clientWeights = JSON.parse(clientWeights.toString());
        let avgWeights = []
        let avgBias = []
        for(let i=0;i<clientWeights[0].layers.length;i++){
            avgWeights.push(clientWeights[0].layers[i].weights);
            avgBias.push(clientWeights[0].layers[i].biases);
        }

        clientWeights.forEach((layer, index)=>{
            const weight = layer.layers
            if(index === 0){
                return
            }
            for(let i=0; i<weight.length; i++){
                avgWeights[i] = tf.add(avgWeights[i], weight[i].weights)
                avgBias[i] = tf.add(avgBias[i], weight[i].biases)
            }
        })


        for(let i=0; i<avgWeights.length; i++){
            avgWeights[i] = tf.div(avgWeights[i], num)
            avgBias[i] = tf.div(avgBias[i], num)
        }

        const modelData = {
            "layers": []
        }

        for(let i=0; i<avgWeights.length; i++){
            let layer = {
                "weights": avgWeights[i].arraySync(),
                "biases": avgBias[i].arraySync()
            }
            modelData.layers.push(layer);
        }

        // const password = crypto.randomBytes(16).toString('hex');
        const password = "password";
        // const iv = crypto.randomBytes(16);
        const iv = Buffer.from('00000000000000000000000000000000', 'hex');

        const key = crypto.scryptSync(password, 'salt', 24);

        sessionKey[round] = {password: key.toString('hex'), iv: iv.toString('hex')};

        const cipher = crypto.createCipheriv(algorithm, key, iv);
        let encrypted = '';
        cipher.on('readable', () => {
            let chunk;
            while (null !== (chunk = cipher.read())) {
                encrypted += chunk.toString('hex');
            }
        });

        cipher.on('end', async() => {
            const transaction2 = contract[0].createTransaction('PutGlobalParams');
            transaction2.setEndorsingOrganizations('Org1MSP', 'Org2MSP');
            await transaction2.submit(encrypted)
            console.log("Client " + 0 + " received weights and sent back");
        });

        cipher.write(JSON.stringify(modelData));
        cipher.end();

    }
    catch(err){
        console.log("GetAllParams " + "Client ID: " + 0 + " " + err);
    }
}


const getEncryptedParams = async(clientInd, round) => {
    try{
        const transaction = contract[clientInd].createTransaction('GetEncryptedParams');
        transaction.setEndorsingOrganizations('Org1MSP', 'Org2MSP');
        const encryptedWeights = await transaction.submit(round);
        let encryptedWeightsString = encryptedWeights.toString();
        console.log("Received encrypted weights for client " + clientInd + " for round " + round);
        return encryptedWeightsString;
    }
    catch(error){
        console.log("GetEncryptedParams " + "Client ID: " + clientInd + " " + error);
    }
}

const putSessionKey = async(privatedataC, round) => {
    try{

        const transaction = contract[0].createTransaction('PutSessionKey');
        const transientData = {
            password: Buffer.from(sessionKey[round].password),
            iv: Buffer.from(sessionKey[round].iv)
        }
        transaction.setEndorsingOrganizations('Org1MSP');
        await transaction.setTransient(transientData).submit(round, privatedataC);

        console.log("Sent symmetric key to client for round " + round);
    }
    catch(error){
        console.log("PutPrivateData " + error);
    }
}

const getSessionKey = async(privatedataC, round, clientInd) => {
    try{
        const transaction = contract[clientInd].createTransaction('GetSessionKey');
        transaction.setEndorsingOrganizations('Org1MSP');
        const key = await transaction.submit(round, privatedataC);
        const keyString = key.toString();
        const keyJSON = JSON.parse(keyString);
        if(!keyJSON.password || !keyJSON.iv){
            console.log("No symmetric key received for client " + clientInd + " for round " + round);
            return null;
        }
        const password = keyJSON.password;
        const iv = keyJSON.iv;
        console.log("Client " + clientInd + " received symmetric key for round " + round);
        return {password, iv};
    }
    catch(error){
        console.log("GetSessionKey " + "Client ID: " + clientInd + " " + error);
    }
}

const requestKey = async(clientInd, round) => {
    try{
        const transaction = contract[clientInd].createTransaction('RequestParams');
        transaction.setEndorsingOrganizations('Org1MSP', 'Org2MSP');
        const result = await transaction.submit(round);
        console.log("Client " + clientInd + " requested key for round " + round);
    }
    catch(error){
        console.log("RequestKey " + "Client ID: " + clientInd + " " + error);
    }
}

const getRequests = async() => {

    try{
        const transaction = contract[0].createTransaction('GetRequests');
        transaction.setEndorsingOrganizations('Org1MSP', 'Org2MSP');
        const result = await transaction.submit();
        let keyrequests = JSON.parse(result.toString());
        console.log("Received requests from clients", JSON.stringify(keyrequests));
        return keyrequests;
    }
    catch(error){
        console.log("GetRequests : " + error);
    }
}

let roundAccuracies = [];

const simulateFL = async() => {

    try{
        
        for(let round=1;round<=25;round++){
            let acc = []
            for (let i = 1; i < nclients; ++i) {
                let current_epsilon = randomInt(4, 12);
                // let current_epsilon = epsilonArray[i];
                await trainModelAndPushParams(i, round, current_epsilon);
                const accuracy = await models[i].testModel();
                acc.push(accuracy);
            }

            await getParamsAndPutGlobals(round);

            for(let i=1;i<nclients;i++){
                await requestKey(i, round);
            }

            let keyrequests = await getRequests();
            let orgs = keyrequests.orgName
            let rounds = keyrequests.round

            for(let i=0;i<orgs.length;i++){
                let privatedataC = privateDataCollection[orgMSP_to_orgName[orgs[i]]];
                let round = rounds[i];
                await putSessionKey(privatedataC, round);
            }


            for(let i=1;i<nclients;i++){
                let encryptedParams = await getEncryptedParams(i, round);
                let privatedataC = privateDataCollection[orgNames[i]];
                let key = await getSessionKey(privatedataC, round, i);
                if(key){
                    console.log(sessionKey[round].iv, sessionKey[round].password)
                    key.password = Buffer.from(key.password, 'hex');
                    key.iv = Buffer.from(key.iv, 'hex');
                    const decipher = crypto.createDecipheriv(algorithm, key.password, key.iv);
                    let decrypted = decipher.update(encryptedParams, 'hex', 'utf8');
                    decrypted += decipher.final('utf8');                    
                    let modelData = JSON.parse(decrypted);
                    await models[i].setWeights(modelData.layers);
                }
            }
            // console.log(acc);
            roundAccuracies.push(acc);
        }

        console.log(roundAccuracies);
        console.log(epsilonArray)
    }
    catch(error){
        console.log("SimulateFL " + error);
    }
}

const main = async() => {

    for(let i=0;i<nclients;i++){
        await initClient(i);
    }

    for (let i = 1; i < nclients; ++i) {
        dataseed[i] = (images_per_class + test_images_per_class) * i;
        models[i] = new MNISTModel(dataseed[i], epsilonArray[i], nepochs);
        await models[i].initModel();
        await models[i].preprocessDataset();
    }

    await simulateFL();

    for (let i = 0; i < nclients; ++i) {
        await gateways[i].disconnect();
    }
}

main();




