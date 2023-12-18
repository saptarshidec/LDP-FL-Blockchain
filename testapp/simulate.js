const FabricCAServices = require('fabric-ca-client');
const { Gateway, Wallets } = require('fabric-network');
const fs = require('fs')
const path = require('path')
const tf = require('@tensorflow/tfjs-node');
const mnist = require('mnist');
const { randomInt } = require('crypto');

let contract=[null, null, null, null,null, null, null, null]
let gateways=[null, null, null, null,null, null, null, null]
let nclients=8
let nepochs=10
let epsilonArray=[8, 8, 8, 8,8,8,8,8]
let userNames = ["appserver", "appuser1", "appuser2", "appuser3","appuser4","appuser5","appuser6","appuser7"]
let models = [null, null, null, null,null, null, null, null]
let images_per_digit=100
let test_images_per_digit=20
let dataseed = [0, 0, 0, 0,0, 0, 0, 0]
const initialWeight=0.05



const initModels = () => {
    for(let i=1; i<nclients; i++){
        models[i] = tf.sequential();

        models[i].add(tf.layers.conv2d({
            inputShape: [28, 28, 1], // MNIST images are 28x28 pixels and have a single channel
            filters: 16,
            kernelSize: 3,
            activation: 'relu',
            kernelInitializer: 'randomNormal'
            // kernelInitializer: tf.initializers.constant({ value: initialWeight })
        }));
    
        // Add a max pooling layer
        models[i].add(tf.layers.maxPooling2d({ poolSize: [2, 2] }));
    
        // Add another 2D convolutional layer with 64 filters
        models[i].add(tf.layers.conv2d({
            filters: 32,
            kernelSize: 3,
            activation: 'relu',
            kernelInitializer: 'randomNormal'
            // kernelInitializer: tf.initializers.constant({ value: initialWeight })
        }));
    
        // Add another max pooling layer
        models[i].add(tf.layers.maxPooling2d({ poolSize: [2, 2] }));
    
        //   Flatten the output to connect to dense layers
        models[i].add(tf.layers.flatten());
    
        // Add a dense layer with 128 units and ReLU activation
        models[i].add(tf.layers.dense({
            units: 128,
            activation: 'relu',
            kernelInitializer: 'randomNormal'
            // kernelInitializer: tf.initializers.constant({ value: initialWeight }) 
        }));
    
        // Add the output layer with 10 units (for 10 classes) and softmax activation
        models[i].add(tf.layers.dense({
            units: 10,
            activation: 'softmax',
            kernelInitializer: 'randomNormal'
            // kernelInitializer: tf.initializers.constant({ value: initialWeight }) 
        }));
    
        // Compile the models[i]
        models[i].compile({
            optimizer: 'adam',
            loss: 'categoricalCrossentropy',
            metrics: ['accuracy']
        });

        console.log("Model "+i+" initialized");
        dataseed[i] = (images_per_digit+test_images_per_digit) * i;
        // models[i].summary();
    }

    console.log("Models initialized");
}

const initClients = async() =>{

    const orgName="org1"
    try{
        const chainCode = "rounds3";
        const ccpPath = path.resolve(`../test-network/organizations/peerOrganizations/${orgName}.example.com/connection-${orgName}.json`);
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

        for(let i=0; i<nclients; i++){
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

            if(!getUser) await contract[i].submitTransaction('InitLedger');
            console.log("Gateway connected for user "+userName);
        }
    }
    catch(error){
        console.log(error);
    }
}

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

const calculateWeights = async(clientInd) =>{

    var inputs = []
    var outputs = []

    for(let i=0; i<10; i++){
    	//console.log("Number of images for digit",i," = ",mnist[i].length)
        let set=mnist[i].set(dataseed[clientInd], dataseed[clientInd]+images_per_digit-1);
        for(let j=0; j<images_per_digit; j++){
            let ip=set[j].input;
            let op=set[j].output;
            inputs = inputs.concat(ip);
            outputs = outputs.concat(op);
        }
    }

    const xTrain = tf.tensor4d(inputs, [inputs.length/784, 28, 28, 1]);
    const yTrain = tf.tensor2d(outputs, [outputs.length/10, 10]);

    await models[clientInd].fit(xTrain, yTrain, {
        epochs: nepochs,
        verbose: 0,
    });

    const weights = models[clientInd].getWeights();
    return weights;
}

const weights_ldp = async(clientInd) =>{

    tf.tidy(()=>{
        for(const layer of models[clientInd].layers){
            const weights = layer.getWeights();
            for(const weight of weights){
                perturbWeights(weight, 0, 0.15, epsilonArray[clientInd]);
            }
        }
    })
}

const trainModelAndPushWeights = async(clientInd) =>{

    try{
        const cn = "appserver"
        var weights = await calculateWeights(clientInd);
        await weights_ldp(clientInd);

        const modelData = {
            "layers":[
                {
                    "weights": models[clientInd].layers[0].getWeights()[0].arraySync(),
                    "biases": models[clientInd].layers[0].getWeights()[1].arraySync()
                },
                {
                    "weights": models[clientInd].layers[2].getWeights()[0].arraySync(),
                    "biases": models[clientInd].layers[2].getWeights()[1].arraySync()
                },
                {
                    "weights": models[clientInd].layers[5].getWeights()[0].arraySync(),
                    "biases": models[clientInd].layers[5].getWeights()[1].arraySync()
                },
                {
                    "weights": models[clientInd].layers[6].getWeights()[0].arraySync(),
                    "biases": models[clientInd].layers[6].getWeights()[1].arraySync()
                }   
            ]
        }

        const modelDataString = JSON.stringify(modelData);
        await contract[clientInd].submitTransaction('PutData', modelDataString, cn, epsilonArray[clientInd]);

        console.log("Client "+clientInd+" trained and sent weights");
    }
    catch(error){
        console.log("TrainModelAndPushWeights "+"Client ID: "+clientInd+" "+error);
    }
}

const getRoundWeights = async(clientInd) => {

    try{
        let num = nclients - 1;
        const seed = randomInt(1000);
        const transaction = contract[clientInd].createTransaction('GetRoundData');
        transaction.setEndorsingOrganizations('Org1MSP', 'Org2MSP');
        const result = await transaction.submit(num, seed);
        //console.log("Result=",result)
        const weightsArray = JSON.parse(result.toString());

        //console.log("Weights array=",weightsArray)
        if(weightsArray.length == 0){
            console.log("No weights received");
            return;
        }
        num = weightsArray.length;
        let layerAvgWeight = [tf.zeros([3, 3, 1, 16]), tf.zeros([3, 3, 1, 32]), tf.zeros([800, 128]), tf.zeros([128, 10])];
        let layerAvgBias = [tf.zeros([16]), tf.zeros([32]), tf.zeros([128]), tf.zeros([10])];

        weightsArray.forEach((layer, index) => {
            const weights=layer.layers;
            for(let i=0; i<4; i++){
                layerAvgWeight[i] = tf.add(layerAvgWeight[i], tf.tensor(weights[i].weights));
                layerAvgBias[i] = tf.add(layerAvgBias[i], tf.tensor(weights[i].biases));
            }
        })

        for(let i=0; i<4; i++){
            layerAvgWeight[i] = tf.div(layerAvgWeight[i], num);
            layerAvgBias[i] = tf.div(layerAvgBias[i], num);
        }
        const modelData = {
            "layers":[
                {
                    "weights": layerAvgWeight[0].arraySync(),
                    "biases": layerAvgBias[0].arraySync()
                },
                {
                    "weights": layerAvgWeight[1].arraySync(),
                    "biases": layerAvgBias[1].arraySync()
                },
                {
                    "weights": layerAvgWeight[2].arraySync(),
                    "biases": layerAvgBias[2].arraySync()
                },
                {
                    "weights": layerAvgWeight[3].arraySync(),
                    "biases": layerAvgBias[3].arraySync()
                }
            ]
        }
	//console.log("Model data=",modelData)
        await contract[clientInd].submitTransaction('PutData', JSON.stringify(modelData), "appserver", epsilonArray[clientInd]);
        console.log("Client "+clientInd+" received weights and sent back");
    }
    catch(error){
        console.log("GetRoundWeights "+"Client ID: "+clientInd+" "+error);
    }
}

const fetchGlobalWeights = async(clientInd, round) => {

    try{
        const cn = "appserver"
        const transaction = contract[clientInd].createTransaction('GetResult');
        transaction.setEndorsingOrganizations('Org1MSP', 'Org2MSP');
        const result = await transaction.submit(cn, round);
        var weightsArray = JSON.parse(result.toString()).layers;
	//console.log("Weights fetched by client ",cn," = ",result);
	//console.log("result for client",clientInd," = ",result)
	//if(weightsArray.length==0){
		//models[clientInd].setWeights([
            	//tf.zeros([3, 3, 1, 16]),
            	//tf.zeros([16]),
            	//tf.zeros([3, 3, 1, 32]),
            	//tf.zeros([32]),
           	//tf.zeros([800, 128]),
            	//tf.zeros([128]),
            	//tf.zeros([128, 10]),
            	//tf.zeros([10])
        	//])
        //}
        if(weightsArray.length>0){
        models[clientInd].setWeights([
            tf.tensor4d(weightsArray[0].weights),
            tf.tensor1d(weightsArray[0].biases),
            tf.tensor4d(weightsArray[1].weights),
            tf.tensor1d(weightsArray[1].biases),
            tf.tensor2d(weightsArray[2].weights),
            tf.tensor1d(weightsArray[2].biases),
            tf.tensor2d(weightsArray[3].weights),
            tf.tensor1d(weightsArray[3].biases)
        ])
        console.log("Client "+clientInd+" received global weights");
        }
	else{
		console.log("Client "+clientInd+" doesnt have sufficient tokens");
	}
    }
    catch(error){
        console.log("FetchGlobalWeights "+"Client ID: "+clientInd+" "+error);
    }
}

const getAccuracy = async(clientInd) => {

    try{
        let inputs = []
        let outputs = []

        for(let i=0;i<10;++i){
            let set=mnist[i].set(dataseed[clientInd]+images_per_digit, dataseed[clientInd]+images_per_digit+test_images_per_digit-1);
            for(let j=0;j<test_images_per_digit;++j){
                let ip=set[j].input;
                let op=set[j].output;
                inputs = inputs.concat(ip);
                outputs = outputs.concat(op);
            }
        }

        const xTest = tf.tensor4d(inputs, [inputs.length/784, 28, 28, 1]);
        const yTest = tf.tensor2d(outputs, [outputs.length/10, 10]);

        const predictions = models[clientInd].predict(xTest);
        const predictionsArray = predictions.arraySync();
        const yTestArray = yTest.arraySync();

        let correct = 0;
        for(let i=0;i<predictionsArray.length;++i){
            const predictedLabel = predictionsArray[i].indexOf(Math.max(...predictionsArray[i]));
            const actualLabel = yTestArray[i].indexOf(Math.max(...yTestArray[i]));
            if(predictedLabel === actualLabel){
                correct++;
            }
        }

        const accuracy = correct / (predictionsArray.length);

        console.log("Client "+clientInd+" accuracy: "+accuracy);
        return accuracy;
    }
    catch(error){
        console.log("GetAccuracy "+"Client ID: "+clientInd+" "+error);
    }
}

let roundAccuracies = []

function getRandomEpsilon(min, max) {
    // By multiplying and adding, we get a random integer within the desired range.
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

const simulFunc = async()=>{

    try{

        for(let round=1; round<=25; round++){
            for(let i=1;i<nclients;++i){
                epsilonArray[i]=getRandomEpsilon(5, 15);
                console.log("Client ",i," epsilon=",epsilonArray[i]);
            }
            for(let i=1;i<nclients;++i){
                await trainModelAndPushWeights(i);
            }
    
            await getRoundWeights(0);
    		
            for(let i=1;i<nclients;++i){
                await fetchGlobalWeights(i, round);
            }
    
            let currAcc = []
            for(let i=1;i<nclients;++i){
                currAcc.push(await getAccuracy(i));
            }
    
            roundAccuracies.push(currAcc);
        }

        console.log(roundAccuracies);

    }
    catch(error){
        console.log(error);
    }
}

const simulate = async() =>{
    await initClients();
    initModels();
    await simulFunc();
    for(let i=0;i<nclients;++i){
        await gateways[i].disconnect();
    }
}

simulate();