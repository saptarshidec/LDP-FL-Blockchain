const FabricCAServices = require('fabric-ca-client');
const {Gateway, Wallets} = require('fabric-network');
const express=require('express');
const app=express();
const fs=require('fs')
const path=require('path')
const cors=require('cors')
const tf = require('@tensorflow/tfjs-node');
const mnist = require('mnist');
const hash = require('object-hash');
const { randomInt } = require('crypto');

app.use(express.urlencoded({ extended: 'false' }));
app.use(express.json());
app.use(cors());

let contract;
let mychannel;
let dataSeed;

let weightLayer1;
let biasLayer1;
let weightLayer2;
let biasLayer2;

let model;

const getAccuracy = async () => {
    const set = mnist.set(5, dataSeed);
    const testSet = set.test;
    const inputs = testSet.map((d) => d.input);
    const outputs = testSet.map((d) => d.output);

    const newInputs = inputs.map((input) => {
        const newInput = [];
        for (let i = 0; i < input.length; i++) {
            if (i % 4 === 0) {
                newInput.push(input[i]);
            }
        }
        return newInput;
    });

    const xTest = tf.tensor2d(newInputs);
    const yTest = tf.tensor2d(outputs);

    const result = model.evaluate(xTest, yTest, { verbose: 0 });
    const testLoss = result[0].dataSync()[0];

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
    return accuracy;
}

app.post('/getroundweights', async (req, res)=>{
    const {num}=req.body;
    try{
        const seed = randomInt(1000);
        // set both peers as endorsers
        const transaction = contract.createTransaction('GetRoundData');
        transaction.setEndorsingOrganizations('Org1MSP', 'Org2MSP');
        const result = await transaction.submit(num, seed);
        const weightsArray=JSON.parse(result.toString());

        if(weightsArray.length===0){
            res.json({"message":"No Weights found in this Round", "records":[]});
            return;
        }

        console.log(weightsArray.length);

        let layer1AvgWeight=tf.zeros([196, 196]);
        let layer1AvgBias=tf.zeros([196]);
        let layer2AvgWeight=tf.zeros([196, 10]);
        let layer2AvgBias=tf.zeros([10]);

        weightsArray.forEach((weights, index)=>{
            const weightsString=(Buffer.from(weights, 'base64').toString());
            const weight=JSON.parse(weightsString);
            layer1AvgWeight=layer1AvgWeight.add(tf.tensor2d(weight[0]));
            layer1AvgBias=layer1AvgBias.add(tf.tensor1d(weight[1]));
            layer2AvgWeight=layer2AvgWeight.add(tf.tensor2d(weight[2]));
            layer2AvgBias=layer2AvgBias.add(tf.tensor1d(weight[3]));
        })

        layer1AvgWeight=layer1AvgWeight.div(weightsArray.length);
        layer1AvgBias=layer1AvgBias.div(weightsArray.length);
        layer2AvgWeight=layer2AvgWeight.div(weightsArray.length);
        layer2AvgBias=layer2AvgBias.div(weightsArray.length);

        const avgWeights=[layer1AvgWeight.arraySync(), layer1AvgBias.arraySync(), layer2AvgWeight.arraySync(), layer2AvgBias.arraySync()];
        const jsonData = JSON.stringify(avgWeights);
        for(let i=0; i<avgWeights[0][0].length; i++){
            avgWeights[0][0][i]=avgWeights[0][0][i].toFixed(2);
        }
        const sendWeights = JSON.stringify(avgWeights[0][0])
        const base64weights = Buffer.from(jsonData).toString('base64');
        await contract.submitTransaction('PutData', base64weights.toString(), "appserver")
        res.json({"message":`Weights Fetched Successfully`, "records":sendWeights});
    }
    catch(err){
        console.log(err.message);
        res.json({"message":err.message, "records":[]});
    }
})

app.get('/getaccuracy', async (req, res)=>{
    try{
        const accuracy=await getAccuracy();
        res.json({"message":`Accuracy: ${accuracy}`});
    }
    catch(err){
        console.log(err);
        res.json({"message":err});
    }
})

app.post('/getweights', async (req, res)=>{
    const {full} = req.body;
    try{
        const result=await contract.evaluateTransaction('GetData')
        const jsonResult=JSON.parse(result.toString());

        jsonResult.data.forEach((record, index)=>{
            const data = record.data;
            const weightsArray=(Buffer.from(data, 'base64').toString());
            if(full==="true") jsonResult.data[index].data=weightsArray;
            else if(full=="false"){
                let ww=JSON.parse(weightsArray)[0][0];
                for(let i=0; i<ww.length; i++){
                    ww[i]=ww[i].toFixed(2);
                }
                jsonResult.data[index].data=ww
            }
            else delete jsonResult.data[index].data;
        })

        res.json({"message":"Weights Fetched Successfully", "records":jsonResult});
    }
    catch(err){
        console.log(err.message);
        res.json({"message":err.message, "records":[]});
    }
})

app.post('/getresult', async (req, res)=>{
    const {round}=req.body;
    try{
        const cn="appserver"
        const transaction = contract.createTransaction('GetResult');
        transaction.setEndorsingOrganizations('Org1MSP', 'Org2MSP');
        const result = await transaction.submit(cn, round);
        const weightsArray=JSON.parse(Buffer.from(result.toString(), 'base64').toString());
        weightLayer1=tf.tensor2d(weightsArray[0]);
        biasLayer1=tf.tensor1d(weightsArray[1]);
        weightLayer2=tf.tensor2d(weightsArray[2]);
        biasLayer2=tf.tensor1d(weightsArray[3]);
        model.setWeights([weightLayer1, biasLayer1, weightLayer2, biasLayer2]);
        res.json({"message":"Result Fetched Successfully", "records":result.toString()});
    }
    catch(err){
        res.json({"message":err.message, "records":[]});
    }
})

const calculateWeights = async () => {

    const set = mnist.set(5, dataSeed);
    const trainingSet = set.training;
    const inputs = trainingSet.map((d) => d.input);
    const outputs = trainingSet.map((d) => d.output);

    const newInputs = inputs.map((input) => {
        const newInput = [];
        for (let i = 0; i < input.length; i++) {
            if (i % 4 === 0) {
                newInput.push(input[i]);
            }
        }
        return newInput;
    });

    const xTrain = tf.tensor2d(newInputs);
    const yTrain = tf.tensor2d(outputs);

    await model.fit(xTrain, yTrain, {
        epochs: 10,
        verbose: 0,
    });

    const weights = model.getWeights();
    weightLayer1=weights[0];
    biasLayer1=weights[1];
    weightLayer2=weights[2];
    biasLayer2=weights[3];

    const weightsJSON = weights.map((weight) => weight.arraySync());
    return weightsJSON;
}

app.get('/putweights', async(req, res)=>{

    try{
        const cn="appserver"
        const weights=await calculateWeights();
        const base64Weights=Buffer.from(JSON.stringify(weights)).toString('base64');
        await contract.submitTransaction('PutData', base64Weights, cn);
        for(let i=0;i<weights[0][0].length;i++){
            weights[0][0][i]=weights[0][0][i].toFixed(2);
        }
        res.json({"message":"Weights Pushed to Ledger Successfully", "records":weights[0][0]});
    }
    catch(err){
        console.log(err.message);
        res.json({"message":err.message, "records":[]});
    }
})

app.post('/login', async(req, res)=>{

    const {orgName, userName}=req.body;
    try{

        const chainCode="rounds3";
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

        dataSeed = parseInt(hash(userName), 16)%500;

        weightLayer1=tf.randomNormal([196, 196]);
        biasLayer1=tf.randomNormal([196]);
        weightLayer2=tf.randomNormal([196, 10]);
        biasLayer2=tf.randomNormal([10]);

        model.setWeights([weightLayer1, biasLayer1, weightLayer2, biasLayer2]);

        console.log("Connected to Gateway");
        mychannel = await gateway.getNetwork('mychannel');

        contract = mychannel.getContract(chainCode);
        if (!getUser) await contract.submitTransaction('InitLedger');

        console.log("Gateway connected");
        res.json({"message":"Login Successful"});
    }
    catch(err){
        console.log(err);
        res.json({"message":"Login Failed"});
    }
})

const PORT = process.argv[2];
app.listen(PORT, async()=>{
    console.log(`Server is running on port ${PORT}`);
    console.log("Initializing Model")
    model = tf.sequential();
    model.add(tf.layers.dense({ inputShape: [196], units: 196, activation: 'relu' }));
    model.add(tf.layers.dense({ units: 10, activation: 'softmax'}));
    model.compile({ optimizer: 'sgd', loss: 'categoricalCrossentropy', metrics: ['accuracy'] });

    const weights = model.getWeights();
    weightLayer1=weights[0];
    biasLayer1=weights[1];
    weightLayer2=weights[2];
    biasLayer2=weights[3];
    console.log("Model Initialized")
})