const FabricCAServices = require('fabric-ca-client');
const { Gateway, Wallets } = require('fabric-network');
const fs = require('fs')
const path = require('path')
const tf = require('@tensorflow/tfjs-node');
const mnist = require('mnist');
const { randomInt } = require('crypto');
const cifar10 = require('cifar10')({ dataPath: './data' })
const fashionmnist = require('fashion-mnist');

let userNames = ["appserver", "appuser1", "appuser2", "appuser3", "appuser4", "appuser5", "appuser6", "appuser7", "appuser8", "appuser9", "appuser10"]
let contract = [null, null, null, null, null, null, null, null, null, null, null]
let gateways = [null, null, null, null, null, null, null, null, null, null, null]
let models = [null, null, null, null, null, null, null, null, null, null, null]
let epsilonArray = [8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8]
let dataseed = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]

let nclients = 2
let nepochs = 10
let images_per_class = 30
let test_images_per_class = 15
const initialWeight = 0.05

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

    async trainModelAndPerturbWeights() { }

    async testModel() { }

    async setWeights(weights) { }

    async weights_ldp() {
        let perturbedWeightsArray = tf.tidy(() => {
            let perturbedWeightsArray = [];
            for (const layer of this.model.layers) {
                const weights = layer.getWeights();
                for (const weight of weights) {
                    const perturbedWeight = perturbWeights(tf.clone(weight), 0, 0.15, this.epsilon);
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
            inputShape: [28, 28, 1], // MNIST images are 28x28 pixels and have a single channel
            filters: 16,
            kernelSize: 3,
            activation: 'relu',
            kernelInitializer: 'randomNormal'
            // kernelInitializer: tf.initializers.constant({ value: initialWeight })
        }));

        // Add a max pooling layer
        this.model.add(tf.layers.maxPooling2d({ poolSize: [2, 2] }));

        // Add another 2D convolutional layer with 64 filters
        this.model.add(tf.layers.conv2d({
            filters: 32,
            kernelSize: 3,
            activation: 'relu',
            kernelInitializer: 'randomNormal'
            // kernelInitializer: tf.initializers.constant({ value: initialWeight })
        }));

        // Add another max pooling layer
        this.model.add(tf.layers.maxPooling2d({ poolSize: [2, 2] }));

        //   Flatten the output to connect to dense layers
        this.model.add(tf.layers.flatten());

        // Add a dense layer with 128 units and ReLU activation
        this.model.add(tf.layers.dense({
            units: 128,
            activation: 'relu',
            kernelInitializer: 'randomNormal'
            // kernelInitializer: tf.initializers.constant({ value: initialWeight }) 
        }));

        // Add the output layer with 10 units (for 10 classes) and softmax activation
        this.model.add(tf.layers.dense({
            units: 10,
            activation: 'softmax',
            kernelInitializer: 'randomNormal'
            // kernelInitializer: tf.initializers.constant({ value: initialWeight }) 
        }));

        // Compile the model
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

    async trainModelAndPerturbWeights() {

        await this.model.fit(this.dataset.inputs, this.dataset.outputs, {
            epochs: nepochs,
            verbose: 0,
        });

        return await this.weights_ldp();
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

    async trainModelAndPerturbWeights() {
        await this.model.fit(this.dataset.inputs, this.dataset.outputs, {
            epochs: nepochs,
            verbose: 0,
        })

        return await this.weights_ldp();
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
            inputShape: [28, 28, 1], // MNIST images are 28x28 pixels and have a single channel
            filters: 16,
            kernelSize: 3,
            activation: 'relu',
            kernelInitializer: 'randomNormal'
            // kernelInitializer: tf.initializers.constant({ value: initialWeight })
        }));

        // Add a max pooling layer
        this.model.add(tf.layers.maxPooling2d({ poolSize: [2, 2] }));

        // Add another 2D convolutional layer with 64 filters
        this.model.add(tf.layers.conv2d({
            filters: 32,
            kernelSize: 3,
            activation: 'relu',
            kernelInitializer: 'randomNormal'
            // kernelInitializer: tf.initializers.constant({ value: initialWeight })
        }));

        // Add another max pooling layer
        this.model.add(tf.layers.maxPooling2d({ poolSize: [2, 2] }));

        //   Flatten the output to connect to dense layers
        this.model.add(tf.layers.flatten());

        // Add a dense layer with 128 units and ReLU activation
        this.model.add(tf.layers.dense({
            units: 128,
            activation: 'relu',
            kernelInitializer: 'randomNormal'
            // kernelInitializer: tf.initializers.constant({ value: initialWeight }) 
        }));

        // Add the output layer with 10 units (for 10 classes) and softmax activation
        this.model.add(tf.layers.dense({
            units: 10,
            activation: 'softmax',
            kernelInitializer: 'randomNormal'
            // kernelInitializer: tf.initializers.constant({ value: initialWeight }) 
        }));

        // Compile the model
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

    async trainModelAndPerturbWeights() {
        const xTrain = tf.tensor4d(this.dataset.inputs, [this.dataset.inputs.length / 784, 28, 28, 1]);
        const yTrain = tf.tensor2d(this.dataset.outputs, [this.dataset.outputs.length / 10, 10]);

        await this.model.fit(xTrain, yTrain, {
            epochs: nepochs,
            verbose: 0,
        });

        return await this.weights_ldp();
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

const initClients = async () => {

    const orgName = "org1"
    try {
        const chainCode = "rounds3";
        const ccpPath = path.resolve(`../../test-network/organizations/peerOrganizations/${orgName}.example.com/connection-${orgName}.json`);
        const ccp = JSON.parse(fs.readFileSync(ccpPath, 'utf8'));

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

        for (let i = 0; i < nclients; i++) {
            let userName = userNames[i]
            const getUser = await wallet.get(userName);
            if (!getUser) {
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
            else {
                console.log(`User ${userName} already exists`);
            }

            const gateway = new Gateway();
            await gateway.connect(ccp, { wallet, identity: userName, discovery: { enabled: true, asLocalhost: true } });

            const network = await gateway.getNetwork('mychannel');
            contract[i] = network.getContract(chainCode);

            gateways[i] = gateway;

            if (!getUser) await contract[i].submitTransaction('InitLedger');
            console.log("Gateway connected for user " + userName);
        }
    }
    catch (error) {
        console.log(error);
    }
}

const trainModelAndPushWeights = async (clientInd) => {

    try {
        let modelData = await models[clientInd].trainModelAndPerturbWeights();
        modelData = await models[clientInd].formatWeights();
        const modelDataString = JSON.stringify(modelData);
        await contract[clientInd].submitTransaction('PutData', modelDataString, epsilonArray[clientInd]);

        console.log("Client " + clientInd + " trained and sent weights");
    }
    catch (error) {
        console.log("TrainModelAndPushWeights " + "Client ID: " + clientInd + " " + error);
    }
}

const getRoundWeights = async (clientInd) => {

    try {
        let num = nclients - 1;
        const seed = randomInt(1000);
        const transaction = contract[clientInd].createTransaction('GetRoundData');
        transaction.setEndorsingOrganizations('Org1MSP', 'Org2MSP');
        await transaction.submit(num, seed);
        console.log("Client " + clientInd + " received weights and sent back");
    }
    catch (error) {
        console.log("GetRoundWeights " + "Client ID: " + clientInd + " " + error);
    }
}

const fetchGlobalWeights = async (clientInd, round) => {

    try {
        const transaction = contract[clientInd].createTransaction('GetResult');
        transaction.setEndorsingOrganizations('Org1MSP', 'Org2MSP');
        const result = await transaction.submit(round);
        var weightsArray = JSON.parse(result.toString()).layers;
        if (weightsArray[0].weights) {
            models[clientInd].setWeights(weightsArray)
            console.log("Client " + clientInd + " received global weights");
        }
        else {
            console.log("Client " + clientInd + " doesnt have sufficient tokens");
        }
    }
    catch (error) {
        console.log("FetchGlobalWeights " + "Client ID: " + clientInd + " " + error);
    }
}

let roundAccuracies = []

function getRandomEpsilon(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

const simulFunc = async () => {

    try {

        for (let round = 1; round <= 25; round++) {
            for (let i = 1; i < nclients; ++i) {
                // epsilonArray[i]=getRandomEpsilon(5, 15);
                console.log("Client ", i, " epsilon=", epsilonArray[i]);
            }
            for (let i = 1; i < nclients; ++i) {
                await trainModelAndPushWeights(i);
            }

            await getRoundWeights(0);

            for (let i = 1; i < nclients; ++i) {
                await fetchGlobalWeights(i, round);
            }

            let currAcc = []
            for (let i = 1; i < nclients; ++i) {
                currAcc.push(await models[i].testModel());
            }

            roundAccuracies.push(currAcc);
        }

        console.log(roundAccuracies);

    }
    catch (error) {
        console.log(error);
    }
}

const simulate = async () => {
    await initClients();
    for (let i = 1; i < nclients; ++i) {
        dataseed[i] = (images_per_class + test_images_per_class) * i;
        models[i] = new CIFARModel(dataseed[i], epsilonArray[i], nepochs);
        await models[i].initModel();
        await models[i].preprocessDataset();
    }
    await simulFunc();
    for (let i = 0; i < nclients; ++i) {
        await gateways[i].disconnect();
    }
}

simulate();