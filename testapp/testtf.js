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
    tf.tidy(() => {
        const processedTensors = weightTensor.map(weight => LDP_FL(weight, c, r, eps));
        weightTensor.assign(tf.concat(processedTensors, 0));
    });
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
    return tf.tidy(() => {
        var inputtest = [];
        var outputtest = [];
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

        return correct / predictionsArray.length;
    });
};

app.post('/getroundweights', async (req, res) => {
    const { num } = req.body;
    try {
        const seed = randomInt(1000);
        console.log(contract);
        const transaction = contract.createTransaction('GetRoundData');
        transaction.setEndorsingOrganizations('Org1MSP', 'Org2MSP');
        const result = await transaction.submit(num, seed);
        const weightsArray = JSON.parse(result.toString());

        if (weightsArray.length === 0) {
            res.json({ "message": "No Weights found in this Round", "records": [] });
            return;
        }

        console.log("Length of weights array = ", weightsArray.length);
        console.log("Weights array shape=", weightsArray.shape);

        let layer1AvgWeight = tf.zeros([3, 3, 1, 16]);
        let layer1AvgBias = tf.zeros([16]);
        let layer2AvgWeight = tf.zeros([3, 3, 1, 32]);
        let layer2AvgBias = tf.zeros([32]);
        let layer3AvgWeight = tf.zeros([800, 128]);
        let layer3AvgBias = tf.zeros([128]);
        let layer4AvgWeight = tf.zeros([128, 10]);
        let layer4AvgBias = tf.zeros([10]);

        let i = 1;
        weightsArray.forEach((weights, index) => {
            const weightsString = (Buffer.from(weights, 'base64').toString());
            const weight = JSON.parse(weightsString);
            console.log("Layer =", index)
            console.log("Weight shape=", weight.length)
            console.log("conv layer 1 weights (Weight[0]) shape=", weight[0].length)
            console.log("Weight[0][0] shape=", weight[0][0].length)
            console.log("Weight[0][0][0] shape=", weight[0][0][0].length)
            console.log("Weight[0][0][0][0] shape=", weight[0][0][0][0].length)
            console.log("conv layer 1 bias (Weight[1]) shape=", weight[1].length)
            console.log("conv layer 2 weights (Weight[2]) shape=", weight[2].length)
            console.log("conv layer 2 bias (Weight[3]) shape=", weight[3].length)
            console.log("Dense layer 1 weights (Weight[4]) shape=", weight[4].length)
            console.log("Dense layer 1 bias (Weight[5]) shape=", weight[5].length)
            console.log("Dense layer 2 weights (Weight[6]) shape=", weight[6].length)
            console.log("Dense layer 2 bias (Weight[7]) shape=", weight[7].length)
            layer1AvgWeight = layer1AvgWeight.add(tf.tensor4d(weight[0]));
            layer1AvgBias = layer1AvgBias.add(tf.tensor1d(weight[1]));
            layer2AvgWeight = layer2AvgWeight.add(tf.tensor4d(weight[2]));
            layer2AvgBias = layer2AvgBias.add(tf.tensor1d(weight[3]));
            layer3AvgWeight = layer3AvgWeight.add(tf.tensor2d(weight[4]));
            layer3AvgBias = layer3AvgBias.add(tf.tensor1d(weight[5]));
            layer4AvgWeight = layer4AvgWeight.add(tf.tensor2d(weight[6]));
            layer4AvgBias = layer4AvgBias.add(tf.tensor1d(weight[7]));
            i = i + 1;

            tf.dispose(weight);
        })
        console.log("Outside")
        layer1AvgWeight = layer1AvgWeight.div(weightsArray.length);
        layer1AvgBias = layer1AvgBias.div(weightsArray.length);
        layer2AvgWeight = layer2AvgWeight.div(weightsArray.length);
        layer2AvgBias = layer2AvgBias.div(weightsArray.length);
        layer3AvgWeight = layer3AvgWeight.div(weightsArray.length);
        layer3AvgBias = layer3AvgBias.div(weightsArray.length);
        layer4AvgWeight = layer4AvgWeight.div(weightsArray.length);
        layer4AvgBias = layer4AvgBias.div(weightsArray.length);

        const avgWeights = [layer1AvgWeight.arraySync(), layer1AvgBias.arraySync(), layer2AvgWeight.arraySync(), layer2AvgBias.arraySync(), layer3AvgWeight.arraySync(), layer3AvgBias.arraySync(), layer4AvgWeight.arraySync(), layer4AvgBias.arraySync()];
        const jsonData = JSON.stringify(avgWeights);
        const base64weights = Buffer.from(jsonData).toString('base64');
        await contract.submitTransaction('PutData', base64weights.toString(), "appserver", epsilon)
        res.json({ "message": `Weights Fetched Successfully`, "records": ["Layer1 Unit1 Weight[0]: " + avgWeights[0][0][0], "Layer1 Bias[0]: " + avgWeights[1][0], "Layer2 Unit1 Weight[0]: " + avgWeights[2][0][0], "Layer2 Bias[0]: " + avgWeights[3][0]] });
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

        jsonResult.data.forEach((record, index) => {
            const data = record.data;
            const weightsArray = (Buffer.from(data, 'base64').toString());
            let parsedWeights = JSON.parse(weightsArray);

            if (full === "true") {
                jsonResult.data[index].data = parsedWeights;
            } else if (full === "false") {
                jsonResult.data[index].data = [
                    "Layer1 Unit1 Weight[0]: " + parsedWeights[0][0][0],
                    "Layer1 Bias[0]: " + parsedWeights[1][0],
                    "Layer2 Unit1 Weight[0]: " + parsedWeights[2][0][0],
                    "Layer2 Bias[0]: " + parsedWeights[3][0]
                ];
            } else {
                delete jsonResult.data[index].data;
            }

            tf.dispose(parsedWeights);
        });

        res.json({ "message": "Weights Fetched Successfully", "records": jsonResult });
    } catch (err) {
        console.log(err.message);
        res.json({ "message": err.message, "records": [] });
    }
});


app.post('/getresult', async (req, res) => {
    const { round } = req.body;
    try {
        const cn = "appserver"
        const transaction = contract.createTransaction('GetResult');
        transaction.setEndorsingOrganizations('Org1MSP', 'Org2MSP');
        const result = await transaction.submit(cn, round);
        const weightsArray = JSON.parse(Buffer.from(result.toString(), 'base64').toString());

        weightLayer1 = tf.tensor4d(weightsArray[0]);
        biasLayer1 = tf.tensor1d(weightsArray[1]);
        weightLayer2 = tf.tensor4d(weightsArray[2]);
        biasLayer2 = tf.tensor1d(weightsArray[3]);
        weightLayer3 = tf.tensor2d(weightsArray[4]);
        biasLayer3 = tf.tensor1d(weightsArray[5]);
        weightLayer4 = tf.tensor2d(weightsArray[6]);
        biasLayer4 = tf.tensor1d(weightsArray[7]);

        model.setWeights([weightLayer1, biasLayer1, weightLayer2, biasLayer2, weightLayer3, biasLayer3, weightLayer4, biasLayer4]);
        console.log("Convolutional Layer 1 Weight[0][0] -", model.layers[0].getWeights()[0].arraySync()[0][0][0]);
        console.log("Weights set")
        res.json({ "message": "Result Fetched Successfully", "records": weightsArray });
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
        epochs: 1,
        verbose: 0,
    });

    console.log("After Training")
    console.log("Convolutional Layer 1 Weight[0][0] -", model.layers[0].getWeights()[0].arraySync()[0][0][0]);
    console.log("Convolutional Layer 1 Bias[0] -", model.layers[0].getWeights()[1].arraySync()[0]);
    console.log("Convolutional Layer 2 Weight[0][0] -", model.layers[2].getWeights()[0].arraySync()[0][0][0]);
    console.log("Convolutional Layer 2 Bias[0] -", model.layers[2].getWeights()[1].arraySync()[0]);

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

    xTrain.dispose();
    yTrain.dispose();
    return weightsJSON;
}

app.get('/putweights', async (req, res) => {

    try {
        const cn = "appserver"
        var weights = await calculateWeights();
        weights = await weights_ldp();
        const base64Weights = Buffer.from(JSON.stringify(weights)).toString('base64');
        await contract.submitTransaction('PutData', base64Weights, cn, epsilon);
        res.json({ "message": "Weights Pushed to Ledger Successfully", "records": ["Layer1 Unit1 Weight[0]: " + weights[0][0][0], "Layer1 Bias[0]: " + weights[1][0], "Layer2 Unit1 Weight[0]: " + weights[2][0][0], "Layer2 Bias[0]: " + weights[3][0]] });
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
