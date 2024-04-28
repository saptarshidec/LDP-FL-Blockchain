const FabricCAServices = require('fabric-ca-client');
const { Gateway, Wallets } = require('fabric-network');
const fs = require('fs')
const path = require('path')

const readline = require('node:readline');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

const connect = async (orgName, username) => {

    const chainCode = "basic"
    const channel = "mychannel"

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

    const gateway = new Gateway();
    await gateway.connect(ccp, { wallet, identity: userName, discovery: { enabled: true, asLocalhost: true } });

    const network = await gateway.getNetwork('mychannel');
    const contract = network.getContract(chainCode);

    console.log('Connected to mychannel');

    // init ledger if not already initialized
    if(!getUser){
        await contract.submitTransaction('InitLedger');
        console.log('Ledger initialized');
    }
    else{
        console.log('Ledger already initialized');
    }

    while(1){
        const choice = await new Promise((resolve) => {
            rl.question('1. Create Asset\n2. Read Asset\n3. Update Asset\n4. Delete Asset\n5. Get All Assets\n', (answer) => {
                resolve(answer);
            });
        });
        if(choice === '5'){
            const result = await contract.evaluateTransaction('GetAllAssets');
            console.log(`All Assets: ${result.toString()}`);
        }
    }
}
const orgName = process.argv[2]
const userName = process.argv[3]

connect(orgName, userName)
