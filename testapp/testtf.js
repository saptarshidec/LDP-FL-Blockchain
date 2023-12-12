const tf = require('@tensorflow/tfjs-node');
const mnist = require('mnist');

async function main() {
    const set = mnist.set(5, 0);
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

    const weightLayer1 = tf.randomNormal([196, 196]);
    const biasLayer1 = tf.randomNormal([196]);
    const weightLayer2 = tf.randomNormal([196, 10]);
    const biasLayer2 = tf.randomNormal([10]);

    const model = tf.sequential();
    model.add(tf.layers.dense({ inputShape: [196], units: 196, activation: 'relu', weights: [weightLayer1, biasLayer1] }));
    model.add(tf.layers.dense({ units: 10, activation: 'softmax', weights: [weightLayer2, biasLayer2]}));
    model.compile({ optimizer: 'sgd', loss: 'categoricalCrossentropy', metrics: ['accuracy'] });

    await model.fit(xTrain, yTrain, {
        epochs: 10,
        verbose: 0,
    });

    const weights = model.getWeights();
    const weightsJSON = weights.map((weight) => weight.arraySync());
    console.log(JSON.stringify(weightsJSON));

}

main();