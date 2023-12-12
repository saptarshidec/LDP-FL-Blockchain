const { Wallets, X509WalletMixin } = require('fabric-network');
const FabricCAServices = require('fabric-ca-client');
const fs=require('fs')
const path=require('path')

async function enrollAdmin(orgName, adminName){

    try{
        const ccpPath = path.resolve(`../organizations/peerOrganizations/${orgName}.example.com/connection-${orgName}.json`)
        const ccp = JSON.parse(fs.readFileSync(ccpPath, 'utf8'))
    
        const caInfo = ccp.certificateAuthorities[`ca.${orgName}.example.com`]
        const caTLSCACerts = caInfo.tlsCACerts.pem
        const ca = new FabricCAServices(caInfo.url, { trustedRoots: caTLSCACerts, verify: false }, caInfo.caName)
    
        const walletPath = path.join(process.cwd(), 'wallet')
        const wallet = await Wallets.newFileSystemWallet(walletPath)
    
        const adminIdentity = await wallet.get(adminName)
        if (adminIdentity) {
            console.log(`An identity for the admin user "admin" already exists in the wallet`)
            return
        }
    
        const enrollment = await ca.enroll({
            enrollmentID: 'admin',
            enrollmentSecret: 'adminpw',
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
    
        await wallet.put(adminName, x509Identity)
        console.log(`Successfully enrolled admin user "admin" and imported it into the wallet`);
    }
    catch(error){
        console.error(`Failed to enroll admin user "admin": ${error}`)
        process.exit(1)
    }
}

enrollAdmin(process.argv[2], process.argv[3])