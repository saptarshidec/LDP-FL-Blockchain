#!/bin/bash

case "$1" in
    "network")
        case "$2" in
            "down")
                ./network.sh down
                ;;
            "up")
                ./network.sh up createChannel -ca
                ./network.sh deployCC -ccn rounds3 -ccp ./my_chaincodes/v4_rounds -ccl go
                ;;
            *)
                echo "Invalid subcommand for network: $2"
                ;;
        esac
        ;;
    "clients")
        cd ./testapp/
        npx nodemon main_new.js 5000 &
        npx nodemon main_new.js 5001 &
        npx nodemon main_new.js 5002 &
        npx nodemon main_new.js 5003 &
        cd ../reactapp/
        PORT=3000 REACT_APP_BACKEND_PORT=5000 npm start &
        PORT=3001 REACT_APP_BACKEND_PORT=5001 npm start &
        PORT=3002 REACT_APP_BACKEND_PORT=5002 npm start &
        PORT=3003 REACT_APP_BACKEND_PORT=5003 npm start &
        ;;
    "kill")
        killall node
        ;;
    *)
        echo "Invalid command: $1"
        ;;
esac
