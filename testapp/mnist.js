const tf = require('@tensorflow/tfjs-node');
const cifar10 = require('cifar10')({dataPath: './data'})
const mnist = require('mnist');
const fashionmnist = require('fashion-mnist');

const main = async() => {

    // var cloth = mnist[0].get(); // single cloth
    // console.log(cloth);
    // cloth = mnist[1].range(0, 100)[50]; // extracting the cloth from a range
    // console.log(cloth)
    // cloth = mnist[4].set(0, 100)[20].input; // extracting the cloth from a dataset
    // console.log(cloth)
    // cloth = mnist.set(8000, 2000).training[0].input; // extracting the cloth from a training set
    // console.log(cloth)
    // cloth = mnist.set(8000, 2000).test[15].input; // extracting the cloth from a test set
    // console.log(cloth)

    cifar10.set(400, 200)
    let train=await cifar10.training.get(1000)
    console.log(train.length)
}

main();

// const main = async() => {

//     console.log(mnist[1].set(10, 11));
// }

// main();

// const main = async() =>{

//     data = await cifar10.test.get(10);
//     console.log(data);
//     data2 = await cifar10.test.get(10);
//     console.log(data2);
//     if(data === data2){
//         console.log('data is the same'); 
//     }
//     // console.log(data[0].output, data2[0].output);
// }

// main();


// const initCIFARModel = () => {
//     for(let i=1; i<nclients; i++){
//         models[i] = tf.sequential();

//         models[i].add(tf.layers.conv2d({
//             kernelSize: 3, 
//             filters: 32,
//             activation: 'relu',
//             padding: 'same',
//             inputShape: [32, 32, 3],
//         }))

//         models[i].add(tf.layers.conv2d({
//             kernelSize: 3,
//             filters: 32,
//             activation: 'relu',
//         }))

//         models[i].add(tf.layers.maxPooling2d({poolSize: [2, 2]}))
//         models[i].add(tf.layers.dropout({rate: 0.25}))

//         models[i].add(tf.layers.conv2d({
//             kernelSize: 3,
//             filters: 64,
//             activation: 'relu',
//             padding: 'same',
//         }))

//         models[i].add(tf.layers.conv2d({
//             kernelSize: 3,
//             filters: 64,
//             activation: 'relu',
//         }))

//         models[i].add(tf.layers.maxPooling2d({poolSize: [2, 2]}))
//         models[i].add(tf.layers.dropout({rate: 0.25}))

//         models[i].add(tf.layers.flatten())
//         models[i].add(tf.layers.dense({units: 512, activation: 'relu'}))

//         models[i].add(tf.layers.dropout({rate: 0.5}))
//         models[i].add(tf.layers.dense({units: 10, activation: 'softmax'}))

//         models[i].compile({
//             optimizer: 'adam',
//             loss: 'categoricalCrossentropy',
//             metrics: ['accuracy']
//         });

//         dataseed[i] = (images_per_digit+test_images_per_digit) * i;
//     }
// }

// const preprocessCIFARDataset = async() => {

//     dataset.push([]);
//     testset.push([]);
//     for(let i=1;i<nclients;++i){
//         dataset.push({inputs: [], outputs: []});
//         testset.push({inputs: [], outputs: []});
//         let training_data = await cifar10.training.get(images_per_digit*10);
//         let test_data = await cifar10.testing.get(test_images_per_digit*10);
//         for(let j=0;j<images_per_digit*10;++j){
//             dataset[i].inputs.concat(training_data[j].input);
//             dataset[i].outputs.concat(training_data[j].output);
//         }
//         for(let j=0;j<test_images_per_digit*10;++j){
//             testset[i].inputs.push(test_data[j].input);
//             testset[i].outputs.push(test_data[j].output);
//         }
//     }
// }

// const trainCIFARModel = async(clientInd) => {
    
//     const xTrain = tf.tensor4d(dataset[clientInd].inputs, [dataset[clientInd].inputs.length/3072, 32, 32, 3]);
//     const yTrain = tf.tensor2d(dataset[clientInd].outputs, [dataset[clientInd].outputs.length/10, 10]);

//     await models[clientInd].fit(xTrain, yTrain, {
//         epochs: nepochs,
//         verbose: 0,
//     });
// }

// const testCIFARModel = async(clientInd) => {

//     const xTest = tf.tensor4d(testset[clientInd].inputs, [testset[clientInd].inputs.length/3072, 32, 32, 3]);
//     const yTest = tf.tensor2d(testset[clientInd].outputs, [testset[clientInd].outputs.length/10, 10]);

//     const predictions = models[clientInd].predict(xTest);
//     const predictionsArray = predictions.arraySync();
//     const yTestArray = yTest.arraySync();

//     let correct = 0;
//     for(let i=0;i<predictionsArray.length;++i){
//         const predictedLabel = predictionsArray[i].indexOf(Math.max(...predictionsArray[i]));
//         const actualLabel = yTestArray[i].indexOf(Math.max(...yTestArray[i]));
//         if(predictedLabel === actualLabel){
//             correct++;
//         }
//     }

//     const accuracy = correct / (predictionsArray.length);

//     console.log("Client "+clientInd+" accuracy: "+accuracy);
//     return accuracy;
// }