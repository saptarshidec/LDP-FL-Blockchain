const { Wallets, X509WalletMixin } = require('fabric-network');
const FabricCAServices = require('fabric-ca-client');
const fs=require('fs')
const path=require('path')

async function enrollUser(orgName, userName, adminname) {
    // try{
        // load the network configuration
        const ccpPath = path.resolve(`../organizations/peerOrganizations/${orgName}.example.com/connection-${orgName}.json`)
        const ccp = JSON.parse(fs.readFileSync(ccpPath, 'utf8'))

        // load the certificate authority
        const caInfo = ccp.certificateAuthorities[`ca.${orgName}.example.com`]
        const caTLSCACerts = caInfo.tlsCACerts.pem
        const ca = new FabricCAServices(caInfo.url, { trustedRoots: caTLSCACerts, verify: false }, caInfo.caName)

        // create wallet, to store user identity
        const walletPath = path.join(process.cwd(), 'wallet')
        const wallet = await Wallets.newFileSystemWallet(walletPath)

        // check if user already exists
        const userIdentity = await wallet.get(userName)
        if (userIdentity) {
            console.log(`An identity for the user ${userName} already exists in the wallet`)
            return
        }

        const attributes = [
            
        ];

        // enroll user, and import identity into wallet
        const adminIdentity = await wallet.get(adminname)
        const provider = wallet.getProviderRegistry().getProvider(adminIdentity.type)
        const adminUser = await provider.getUserContext(adminIdentity, adminname)

        console.log(`Registering and enrolling user ${userName}...`);
        const secret = await ca.register({
            affiliation: `${orgName}.department1`,
            enrollmentID: userName,
            role: 'client',
            attrs: attributes,
        }, adminUser)

        const enrollment = await ca.enroll({
            enrollmentID: userName,
            enrollmentSecret: secret,
        })

        const OrgName=orgName.charAt(0).toUpperCase() + orgName.slice(1)

        const x509Identity = {
            credentials: {
                certificate: enrollment.certificate,
                privateKey: enrollment.key.toBytes(),
            },
            mspId: `${OrgName}MSP`,
            type: 'X.509',
        }

        await wallet.put(userName, x509Identity)
        console.log(`Successfully enrolled user ${userName} and imported it into the wallet`);

    // }
    // catch(error) {
    //     console.error(`Failed to enroll user ${userName}: ${error}`)
    // }
}

enrollUser(process.argv[2], process.argv[3], process.argv[4])
