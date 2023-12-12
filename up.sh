#!/bin/bash

case "$1" in
    "network")
        case "$2" in
            "down")
                ./network.sh down
                ;;
            "up")
                ./network.sh up createChannel -ca
                ./network.sh deployCC -ccn rounds3 -ccp ./my_chaincodes/v3_rounds -ccl go
                ;;
            *)
                echo "Invalid subcommand for network: $2"
                ;;
        esac
        ;;
    "clients")
        cd testapp/
        nodemon app.js 5000 &
        nodemon app.js 5001 &
        nodemon app.js 5002 &
        cd ../reactapp/
        PORT=3000 REACT_APP_BACKEND_PORT=5000 npm start &
        PORT=3001 REACT_APP_BACKEND_PORT=5001 npm start &
        PORT=3002 REACT_APP_BACKEND_PORT=5002 npm start &
        ;;
    "kill")
        killall node
        ;;
    *)
        echo "Invalid command: $1"
        ;;
esac
