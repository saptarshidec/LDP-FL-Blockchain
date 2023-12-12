// enroll org1 peer0 with role create, admin, peer, client
const { Wallets, Gateway } = require('fabric-network')
const FabricCAServices = require('fabric-ca-client')
const fs = require('fs')
const path = require('path')

const main = async () => {
        // load connection profile
        const ccpPath = path.resolve('../test-network/organizations/peerOrganizations/org1.example.com/connection-org1.json')
        const ccp = JSON.parse(fs.readFileSync(ccpPath, 'utf8'))

        // create ca client
        const caURL = ccp.certificateAuthorities['ca.org1.example.com'].url
        const ca = new FabricCAServices(caURL)

        // create wallet
        const walletPath = path.join(process.cwd(), 'wallet')
        const wallet = await Wallets.newFileSystemWallet(walletPath)

        // get admin identity
        const enrollment = await ca.enroll({ enrollmentID: 'admin', enrollmentSecret: 'adminpw' })

        const x509Identity = {
            credentials: {
                certificate: enrollment.certificate,
                privateKey: enrollment.key.toBytes(),
            },
            mspId: 'Org1MSP',
            type: 'X.509',
        }

        await wallet.put('admin', x509Identity)

        console.log('Successfully enrolled admin user and imported it into the wallet');
        const adminIdentity = await wallet.get('admin')

        let userIdentity = await wallet.get('appUser')


        if (!userIdentity) {

            const provider=wallet.getProviderRegistry().getProvider(adminIdentity.type)
            const adminUser=await provider.getUserContext(adminIdentity, 'admin')

            const secret=await ca.register({
                affiliation:'org1.department1',
                enrollmentID:'appUser',
                role:'client',
                attrs: [{"name":"hf.Registrar.Roles","value":"client,create,peer,admin"}],
            }, adminUser)

            const enrollment=await ca.enroll({
                enrollmentID:'appUser',
                enrollmentSecret:secret,
            })
            
            const x509Identity={
                credentials:{
                    certificate:enrollment.certificate,
                    privateKey:enrollment.key.toBytes(),
                },
                mspId:'Org1MSP',
                type:'X.509',
            }

            await wallet.put('appUser', x509Identity)
            console.log('Successfully registered and enrolled admin user "appUser" and imported it into the wallet');
        }

        // connect to gateway
        const gateway = new Gateway()

        await gateway.connect(ccp, {
            wallet,
            identity:'appUser',
            discovery: { enabled: true, asLocalhost: true }
        })
}

main()