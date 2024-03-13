const crypto = require('crypto');

const algorithm = 'aes-192-cbc';
const password = 'password';
const text_to_encrypt = 'Hello, world!';

const key = crypto.scryptSync(password, 'salt', 24);
const iv = crypto.randomBytes(16);
const cipher = crypto.createCipheriv(algorithm, key, iv);

let encrypted = '';
cipher.on('readable', () => {
    let chunk;
    while (null !== (chunk = cipher.read())) {
        encrypted += chunk.toString('hex');
    }
});

cipher.on('end', () => {
    console.log(encrypted);
});

cipher.write(text_to_encrypt);
cipher.end();

// Decryption
const decipher = crypto.createDecipheriv(algorithm, key, iv);

let decrypted = '';
decipher.on('readable', () => {
    while (null !== (chunk = decipher.read())) {
        decrypted += chunk.toString('utf8');
    }
});

decipher.on('end', () => {
    console.log(decrypted);
});


decipher.write(encrypted, 'hex');
decipher.end();