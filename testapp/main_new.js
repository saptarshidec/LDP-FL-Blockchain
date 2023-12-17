const FabricCAServices = require('fabric-ca-client');
const { Gateway, Wallets } = require('fabric-network');
const express = require('express');
const app = express();
const fs = require('fs')
const path = require('path')
const cors = require('cors')
const tf = require('@tensorflow/tfjs-node');
const mnist = require('mnist');
const { randomInt } = require('crypto');

app.use(express.urlencoded({ extended: 'false' }));
app.use(express.json());
app.use(cors());

let contract;
let mychannel;
let dataSeed;
let images_per_digit;
let test_images_per_digit;
let epsilon;

let weightLayer1;
let biasLayer1;
let weightLayer2;
let biasLayer2;
let weightLayer3;
let biasLayer3;
let weightLayer4;
let biasLayer4;

let model;

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
    weightTensor.assign(newWeightTensor);
}

const weights_ldp = async () => {
    tf.tidy(() => {
        for (const layer of model.layers) {
            const weights = layer.getWeights();
            for (const weightTensor of weights) {
                perturbWeights(weightTensor, 0, 0.15, 8)
            }
        }
        console.log('Model perturbed!')
    });

    const weights = model.getWeights();

    const layer1 = model.layers[0].getWeights();
    const layer2 = model.layers[2].getWeights();
    const layer3 = model.layers[5].getWeights();
    const layer4 = model.layers[6].getWeights();

    weightLayer1 = layer1[0];
    biasLayer1 = layer1[1];

    weightLayer2 = layer2[0];
    biasLayer2 = layer2[1];

    weightLayer3 = layer3[0];
    biasLayer3 = layer3[1];

    weightLayer4 = layer4[0];
    biasLayer4 = layer4[1];

    const weightsJSON = weights.map((weight) => weight.arraySync());

    return weightsJSON;
}

const getAccuracy = async () => {
    var inputtest = []
    var outputtest = []
    for (let i = 0; i <= 9; i++) {
        let set = mnist[i].set(dataSeed + images_per_digit, dataSeed + images_per_digit + test_images_per_digit - 1);
        for (let j = 0; j < test_images_per_digit; j++) {
            let ip = set[j].input;
            let op = set[j].output;
            inputtest = inputtest.concat(ip);
            outputtest = outputtest.concat(op);
        }
    }

    const xTest = tf.tensor4d(inputtest, [inputtest.length / 784, 28, 28, 1]);
    const yTest = tf.tensor2d(outputtest, [outputtest.length / 10, 10]);

    const predictions = model.predict(xTest);
    const predictionsArray = predictions.arraySync();
    const yTestArray = yTest.arraySync();

    let correct = 0;
    for (let i = 0; i < predictionsArray.length; i++) {
        const predictedLabel = predictionsArray[i].indexOf(Math.max(...predictionsArray[i]));
        const actualLabel = yTestArray[i].indexOf(Math.max(...yTestArray[i]));
        if (predictedLabel === actualLabel) correct++;
    }

    const accuracy = correct / predictionsArray.length;

    xTest.dispose();
    yTest.dispose();
    predictions.dispose();
    return accuracy;
}

app.post('/getroundweights', async (req, res) => {
    const { num } = req.body;
    try {
        const seed = randomInt(1000);
        // set both peers as endorsers
        const transaction = contract.createTransaction('GetRoundData');
        transaction.setEndorsingOrganizations('Org1MSP', 'Org2MSP');
        const result = await transaction.submit(num, seed);
        // console.log("Result=", result.toString());
        const weightsArray = JSON.parse(result.toString());

        if (weightsArray.length === 0) {
            res.json({ "message": "No Weights found in this Round", "records": [] });
            return;
        }

        let layer1AvgWeight = tf.zeros([3, 3, 1, 16]);
        let layer1AvgBias = tf.zeros([16]);
        let layer2AvgWeight = tf.zeros([3, 3, 1, 32]);
        let layer2AvgBias = tf.zeros([32]);
        let layer3AvgWeight = tf.zeros([800, 128]);
        let layer3AvgBias = tf.zeros([128]);
        let layer4AvgWeight = tf.zeros([128, 10]);
        let layer4AvgBias = tf.zeros([10]);

        let i = 1;
        weightsArray.forEach((layer, index) => {
            const weights = layer.layers;
            layer1AvgWeight = layer1AvgWeight.add(tf.tensor4d(weights[0].weights));
            layer1AvgBias = layer1AvgBias.add(tf.tensor1d(weights[0].biases));
            layer2AvgWeight = layer2AvgWeight.add(tf.tensor4d(weights[1].weights));
            layer2AvgBias = layer2AvgBias.add(tf.tensor1d(weights[1].biases));
            layer3AvgWeight = layer3AvgWeight.add(tf.tensor2d(weights[2].weights));
            layer3AvgBias = layer3AvgBias.add(tf.tensor1d(weights[2].biases));
            layer4AvgWeight = layer4AvgWeight.add(tf.tensor2d(weights[3].weights));
            layer4AvgBias = layer4AvgBias.add(tf.tensor1d(weights[3].biases));
            console.log("Round ",i," done")
            i = i + 1;
        })
        layer1AvgWeight = layer1AvgWeight.div(weightsArray.length);
        layer1AvgBias = layer1AvgBias.div(weightsArray.length);
        layer2AvgWeight = layer2AvgWeight.div(weightsArray.length);
        layer2AvgBias = layer2AvgBias.div(weightsArray.length);
        layer3AvgWeight = layer3AvgWeight.div(weightsArray.length);
        layer3AvgBias = layer3AvgBias.div(weightsArray.length);
        layer4AvgWeight = layer4AvgWeight.div(weightsArray.length);
        layer4AvgBias = layer4AvgBias.div(weightsArray.length);

        const modelData = {
            "layers": [
                {
                    "weights": layer1AvgWeight.arraySync(),
                    "biases": layer1AvgBias.arraySync()
                },
                {
                    "weights": layer2AvgWeight.arraySync(),
                    "biases": layer2AvgBias.arraySync()
                },
                {
                    "weights": layer3AvgWeight.arraySync(),
                    "biases": layer3AvgBias.arraySync()
                },
                {
                    "weights": layer4AvgWeight.arraySync(),
                    "biases": layer4AvgBias.arraySync()
                }
            ]
        }

        console.log("Model data=", modelData);
        await contract.submitTransaction('PutData', JSON.stringify(modelData), "appserver", epsilon);

        res.json({ "message": `Weights Fetched Successfully`, "records": "Layer1 Unit1 Weight[0]: " + modelData.layers[0].weights[0][0][0] + "Layer1 Bias[0]: " + modelData.layers[0].biases[0] + "Layer2 Unit1 Weight[0]: " + modelData.layers[1].weights[0][0][0] + "Layer2 Bias[0]: " + modelData.layers[1].biases[0] });
    }
    catch (err) {
        console.log(err.message);
        res.json({ "message": err.message, "records": [] });
    }
})

app.get('/getaccuracy', async (req, res) => {
    try {
        const accuracy = await getAccuracy();
        res.json({ "message": `Accuracy: ${accuracy}` });
    }
    catch (err) {
        console.log(err);
        res.json({ "message": err });
    }
})

app.post('/getweights', async (req, res) => {
    const { full } = req.body;
    try {
        const result = await contract.evaluateTransaction('GetData')
        const jsonResult = JSON.parse(result.toString());

        jsonResult.data.layers = jsonResult.data.layers[0].weights;

        res.json({ "message": "Weights Fetched Successfully", "records": jsonResult });
    }
    catch (err) {
        console.log(err.message);
        res.json({ "message": err.message, "records": [] });
    }
})

app.post('/getresult', async (req, res) => {
    const { round } = req.body;
    try {
        const cn = "appserver"
        const transaction = contract.createTransaction('GetResult');
        transaction.setEndorsingOrganizations('Org1MSP', 'Org2MSP');
        const result = await transaction.submit(cn, round);
        const weightsArray = JSON.parse(result.toString()).layers;

        console.log("Weights array=", weightsArray);

        weightLayer1 = tf.tensor4d(weightsArray[0].weights);
        biasLayer1 = tf.tensor1d(weightsArray[0].biases);
        weightLayer2 = tf.tensor4d(weightsArray[1].weights);
        biasLayer2 = tf.tensor1d(weightsArray[1].biases);
        weightLayer3 = tf.tensor2d(weightsArray[2].weights);
        biasLayer3 = tf.tensor1d(weightsArray[2].biases);
        weightLayer4 = tf.tensor2d(weightsArray[3].weights);
        biasLayer4 = tf.tensor1d(weightsArray[3].biases);

        model.setWeights([weightLayer1, biasLayer1, weightLayer2, biasLayer2, weightLayer3, biasLayer3, weightLayer4, biasLayer4]);
        console.log("Convolutional Layer 1 Weight[0][0] -", model.layers[0].getWeights()[0].arraySync()[0][0][0]);
        console.log("Weights set")
        res.json({ "message": "Result Fetched Successfully", "records": "Layer1 Unit1 Weight[0]: " + weightsArray[0].weights[0][0][0] + "Layer1 Bias[0]: " + weightsArray[0].biases[0] + "Layer2 Unit1 Weight[0]: " + weightsArray[1].weights[0][0][0] + "Layer2 Bias[0]: " + weightsArray[1].biases[0] });
    }
    catch (err) {
        console.log(err.message);
        res.json({ "message": err.message, "records": [] });
    }
})

const calculateWeights = async () => {

    console.log("Data Seed=", dataSeed, "Images per digit=", images_per_digit, "Test images per digit=", test_images_per_digit)
    var inputs = []
    var outputs = []
    for (let i = 0; i <= 9; i++) {
        console.log("Size of dataset for 1 digit=", mnist[i].length)
        // let set=mnist[i].set(dataSeed,dataSeed+images_per_digit-1);
        let set = mnist[i].set(dataSeed, dataSeed + images_per_digit - 1);
        for (let j = 0; j < images_per_digit; j++) {
            let ip = set[j].input;
            let op = set[j].output;
            inputs = inputs.concat(ip);
            outputs = outputs.concat(op);
        }
    }

    console.log("Output length=", outputs.length)
    console.log("Len=", inputs.length)
    console.log("Inputs shape=", inputs.length)
    console.log("Outputs shape=", outputs.length)
    const xTrain = tf.tensor4d(inputs, [inputs.length / 784, 28, 28, 1]);
    const yTrain = tf.tensor2d(outputs, [outputs.length / 10, 10]);

    await model.fit(xTrain, yTrain, {
        epochs: 10,
        verbose: 0,
    });

    const weights = model.getWeights();

    const layer1 = model.layers[0].getWeights();
    const layer2 = model.layers[2].getWeights();
    const layer3 = model.layers[5].getWeights();
    const layer4 = model.layers[6].getWeights();

    weightLayer1 = layer1[0];
    biasLayer1 = layer1[1];

    weightLayer2 = layer2[0];
    biasLayer2 = layer2[1];

    weightLayer3 = layer3[0];
    biasLayer3 = layer3[1];

    weightLayer4 = layer4[0];
    biasLayer4 = layer4[1];

    const weightsJSON = weights.map((weight) => weight.arraySync());

    // dispose of tensors we are finished with
    xTrain.dispose();
    yTrain.dispose();
    return weightsJSON;
}

app.get('/putweights', async (req, res) => {

    try {
        const cn = "appserver"
        var weights = await calculateWeights();
        console.log("Weights before perturbing=",weights)
        weights = await weights_ldp();
        console.log("Weights after perturbing=",weights)

        const modelData = {
            "layers": [
                {
                    "weights": weightLayer1.arraySync(),
                    "biases": biasLayer1.arraySync()
                },
                {
                    "weights": weightLayer2.arraySync(),
                    "biases": biasLayer2.arraySync()
                },
                {
                    "weights": weightLayer3.arraySync(),
                    "biases": biasLayer3.arraySync()
                },
                {
                    "weights": weightLayer4.arraySync(),
                    "biases": biasLayer4.arraySync()
                }
            ]
        }

        const modelDataString = JSON.stringify(modelData);
        await contract.submitTransaction('PutData', modelDataString, cn, epsilon);

        res.json({"message": "Weights pushed", records: "Layer1 Unit1 Weight[0]: " + modelData.layers[0].weights[0][0][0] + "Layer1 Bias[0]: " + modelData.layers[0].biases[0] + "Layer2 Unit1 Weight[0]: " + modelData.layers[1].weights[0][0][0] + "Layer2 Bias[0]: " + modelData.layers[1].biases[0]});
    }
    catch (err) {
        console.log(err.message);
        res.json({ "message": err.message, "records": [] });
    }
})

app.post('/login', async (req, res) => {

    const { orgName, userName } = req.body;
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

        const userIdentity = await wallet.get(userName);
        const gateway = new Gateway();

        await gateway.connect(ccp, {
            wallet,
            identity: userName,
            discovery: { enabled: true, asLocalhost: true }
        });

        console.log("Connected to Gateway");
        mychannel = await gateway.getNetwork('mychannel');

        contract = mychannel.getContract(chainCode);
        if (!getUser) await contract.submitTransaction('InitLedger');

        console.log("Gateway connected");
        res.json({ "message": "Login Successful" });
    }
    catch (err) {
        console.log(err);
        res.json({ "message": "Login Failed" });
    }
})

const PORT = process.argv[2];
app.listen(PORT, async () => {
    console.log(`Server is running on port ${PORT}`);
    console.log("Initializing Model")
    model = tf.sequential();
    epsilon = 8;
    images_per_digit = 75;
    test_images_per_digit = 15;
    const initialWeight = 0.05

    model.add(tf.layers.conv2d({
        inputShape: [28, 28, 1], // MNIST images are 28x28 pixels and have a single channel
        filters: 16,
        kernelSize: 3,
        activation: 'relu',
        kernelInitializer: 'randomNormal'
        // kernelInitializer: tf.initializers.constant({ value: initialWeight })
    }));

    // Add a max pooling layer
    model.add(tf.layers.maxPooling2d({ poolSize: [2, 2] }));

    // Add another 2D convolutional layer with 64 filters
    model.add(tf.layers.conv2d({
        filters: 32,
        kernelSize: 3,
        activation: 'relu',
        kernelInitializer: 'randomNormal'
        // kernelInitializer: tf.initializers.constant({ value: initialWeight })
    }));

    // Add another max pooling layer
    model.add(tf.layers.maxPooling2d({ poolSize: [2, 2] }));

    //   Flatten the output to connect to dense layers
    model.add(tf.layers.flatten());

    // Add a dense layer with 128 units and ReLU activation
    model.add(tf.layers.dense({
        units: 128,
        activation: 'relu',
        kernelInitializer: 'randomNormal'
        // kernelInitializer: tf.initializers.constant({ value: initialWeight }) 
    }));

    // Add the output layer with 10 units (for 10 classes) and softmax activation
    model.add(tf.layers.dense({
        units: 10,
        activation: 'softmax',
        kernelInitializer: 'randomNormal'
        // kernelInitializer: tf.initializers.constant({ value: initialWeight }) 
    }));

    // Compile the model
    model.compile({
        optimizer: 'adam',
        loss: 'categoricalCrossentropy',
        metrics: ['accuracy']
    });

    dataSeed = 100 * (parseInt(PORT) % 100);
    // Print a summary of the model's architecture
    model.summary();


    const layer1 = model.layers[0].getWeights();
    const layer2 = model.layers[2].getWeights();
    const layer3 = model.layers[5].getWeights();
    const layer4 = model.layers[6].getWeights();

    weightLayer1 = layer1[0];
    biasLayer1 = layer1[1];

    weightLayer2 = layer2[0];
    biasLayer2 = layer2[1];

    weightLayer3 = layer3[0];
    biasLayer3 = layer3[1];

    weightLayer4 = layer4[0];
    biasLayer4 = layer4[1];


    console.log("Model Initialized")
})
