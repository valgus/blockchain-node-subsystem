'use strict';
const CryptoJS = require("crypto-js");
const express = require("express");
const bodyParser = require('body-parser');
const WebSocket = require("ws");
const fs = require('fs');

const uuid = require('uuid/v4');


const http_port = process.env.HTTP_PORT || 3001;
const p2p_port = process.env.P2P_PORT || 6001;
const initialPeers = process.env.PEERS ? process.env.PEERS.split(',') : [];


const REQUESTS_FILE = 'requests.json';
const CONFIRMATION_FILE = 'confirmations.js';
const INFO_FILE = 'info.js';

class Block {
    constructor(index, previousHash, timestamp, data, hash) {
        this.index = index;
        this.previousHash = previousHash.toString();
        this.timestamp = timestamp;
        this.data = data;
        this.hash = hash.toString();
    }
}

const sockets = [];
const MessageType = {
    QUERY_LATEST: 0,
    QUERY_ALL: 1,
    RESPONSE_BLOCKCHAIN: 2
};

const ContentType = {
  REQUESTS: 0,
  CONFIRMATION: 1,
  INFO: 2
}

const getGenesisBlock = (string) => {
    return new Block(0, "0", 1465154705, [], 'eac639d204d0e9933b86681c6298600021cc36d0b5d7743f5cd9a051ce1ed34d');
};


const prepareData = () => {
  [REQUESTS_FILE, CONFIRMATION_FILE, INFO_FILE].map((file) => {
    if (!fs.existsSync(file)) {
        const obj = {
           blocks: []
        };
        obj.blocks.push(getGenesisBlock(file));
        const json = JSON.stringify(obj);
        fs.writeFileSync(file, json, 'utf8');
    }
  });
}

const initHttpServer = () => {
    const app = express();
    app.use(bodyParser.json());

    app.get('/abc', (req, res) => res.send("cool"));
    app.get('/requestsBlock', (req, res) => {
      console.error("lwkdfjhfdk")
      fs.readFile(REQUESTS_FILE, 'utf8', (err, data) => {
        console.warn(err, data);
          if (err){
            console.warn(err);
            res.send(JSON.stringify(err));
          } else {
            res.send(data);
          }
      });
    });
    app.get('/infoBlock', (req, res) => {
      console.log('here');
      fs.readFile(INFO_FILE, 'utf8', (err, data) => {
        console.warn(err, data);
          if (err){
            console.warn(err);
            res.send(JSON.stringify(err));
          } else {
            res.send(data);
          }
      });
    });
    app.get('/getConfirmations', (req, res) => {
      console.log("==============Get department info==================");
      const id = req.query.id;
      const confirmationBlock = getLatestBlock(ContentType.CONFIRMATION);
      const infoBlock = getLatestBlock(ContentType.INFO);
      const confirmations = [];
      confirmationBlock.data.map((confirmation) => {
        console.log(confirmation);
        if (confirmation.id === id) {
          console.log("ading department that give confirmation");
          for (const depId of confirmation.confirmedIds) {
            confirmations.push({id: depId, url: infoBlock.data.find((depInfo) => depInfo.id === depId).endpoint, name: infoBlock.data.find((depInfo) => depInfo.id === depId).name});
          }
        }
      });
      res.send(confirmations);
    });
    app.get('/getDepartmentInfo', (req, res) => {
      console.log("==============Get department info==================");
      const id = req.query.id;
      const infoBlock = getLatestBlock(ContentType.INFO);
      const confirmationBlock = getLatestBlock(ContentType.CONFIRMATION);
      const requestsBlock = getLatestBlock(ContentType.REQUESTS);

      const confirmations = [];
      const depConfirmations = []; //confirmations given by department
      const depRequests = [];
      const toDepRequests = [];
      let deps = infoBlock.data.map((info) => { return {id: info.id, name: info.name}});
      deps = deps.filter(info => info.id !== id);
        console.log("blockchainId", id);
      confirmationBlock.data.map((confirmation) => {
        console.log(confirmation);
        if (confirmation.id === id) {
          console.log("ading department that give confirmation");
          for (const depId of confirmation.confirmedIds) {
            confirmations.push({id: depId, name: infoBlock.data.find((depInfo) => depInfo.id === depId).name});
            deps = deps.filter(info => info.id !== depId);
          }
        }
        if (confirmation.confirmedIds.indexOf(id) >= 0) {
          console.log("ading department that was given confirmation");
          depConfirmations.push({id: confirmation.id, name: infoBlock.data.find((depInfo) => depInfo.id === confirmation.id).name});
        }
      });
      requestsBlock.data.map((request) => {
        console.log(request);
          if (request.toId === id) {
            console.log("Add to toDepRequests");
            toDepRequests.push({id: request.fromId, name: infoBlock.data.find((depInfo) => depInfo.id === request.fromId).name});
          }
          if (request.fromId === id) {
            console.log("Add to depRequests");
            depRequests.push({id: request.toId, name: infoBlock.data.find((depInfo) => depInfo.id === request.toId).name});
            deps = deps.filter(info => info.id !== request.toId);
          }
      });
      res.send({deps, confirmations, depRequests, toDepRequests, depConfirmations})
    });
    app.post('/mineInfoBlock', (req, res) => {
        const block = getLatestBlock(ContentType.INFO);
        if (!block) {
          console.log("Error during last block for info retrieving.");
          return res.status(500).json("Error with info data retrieving");
        }
        let id = 0;
        let contains = true;
        while(contains) {
          id =  uuid();
          contains = block.data.filter((dep) => dep.id === id).length !== 0;
        }
        const depInfo = {
          id,
          name: req.body.name,
          endpoint: req.body.endpoint
        };
        addBlock(ContentType.INFO, depInfo, () => {
          broadcast(responseLatestMsg(ContentType.INFO));
          console.log('block added for the data: ', JSON.stringify(req.body));
          res.send(id);
        });
    });
    app.post('/mineConfirmsBlock', (req, res) => {
        addBlock(ContentType.CONFIRMATION, req.body, () => {
          broadcast(responseLatestMsg(ContentType.CONFIRMATION));
          console.log('block added for the data: ', JSON.stringify(req.body));
          res.send();
        });
    });

    app.post('/mineRequestsBlock', (req, res) => {
      console.log("==============Mine request block==================");
        addBlock(ContentType.REQUESTS, req.body, () => {
          broadcast(responseLatestMsg(ContentType.REQUESTS));
          console.log('block added for the data: ', JSON.stringify(req.body));
          res.send();
        });
    });
    app.get('/peers', (req, res) => {
        res.send(sockets.map(s => s._socket.remoteAddress + ':' + s._socket.remotePort));
    });
    app.post('/addPeer', (req, res) => {
        connectToPeers([req.body.peer]);
        res.send();
    });
    app.listen(http_port, () => console.log('Listening http on port: ' + http_port));
};


const initP2PServer = () => {
    const server = new WebSocket.Server({port: p2p_port});
    server.on('connection', ws => initConnection(ws));
    console.log('listening websocket p2p port on: ' + p2p_port);

};

const initConnection = (ws) => {
    sockets.push(ws);
    initMessageHandler(ws);
    initErrorHandler(ws);
    write(ws, queryChainLengthMsg(ContentType.CONFIRMATION));
    write(ws, queryChainLengthMsg(ContentType.REQUESTS));
    write(ws, queryChainLengthMsg(ContentType.INFO));
};

const initMessageHandler = (ws) => {
    ws.on('message', (data) => {
      console.log('In init message handler', data);
      if (data) {
        const message = JSON.parse(data);
        console.log('Received message' + JSON.stringify(message));
        switch (message.type) {
            case MessageType.QUERY_LATEST:
                console.log('from ', ws.url, ' data type: query latest' );
                write(ws, responseLatestMsg(message.contentType));
                break;
            case MessageType.QUERY_ALL:
                console.log('from ', ws.url, ' data type: query all' );
                write(ws, responseChainMsg(message.contentType));
                break;
            case MessageType.RESPONSE_BLOCKCHAIN:
                console.log('from ', ws.url, ' data type: response chain' );
                handleBlockchainResponse(message);
                break;
        }
      }
    });
};

const initErrorHandler = (ws) => {
    const closeConnection = (ws) => {
        console.log('connection failed to peer: ' + ws.url);
        sockets.splice(sockets.indexOf(ws), 1);
    };
    ws.on('close', () => closeConnection(ws));
    ws.on('error', () => closeConnection(ws));
};


const generateNextBlock = (previousBlock) => {
    const nextIndex = previousBlock.index + 1;
    const nextTimestamp = new Date().getTime() / 1000;
    const nextHash = calculateHash(nextIndex, previousBlock.hash, nextTimestamp);
    return new Block(nextIndex, previousBlock.hash, nextTimestamp, '', nextHash);
};


const calculateHashForBlock = (block) => {
    return calculateHash(block.index, block.previousHash, block.timestamp, block.data);
};

const calculateHash = (index, previousHash, timestamp) => {
    return CryptoJS.SHA256(index + previousHash + timestamp).toString();
};

const addBlock = (contentType, content, callback) => {
  let toFile = '';
  console.log('in add block', contentType);
  switch(contentType) {
    case ContentType.CONFIRMATION: toFile = CONFIRMATION_FILE; break;
    case ContentType.REQUESTS: toFile = REQUESTS_FILE; break;
    case ContentType.INFO: toFile = INFO_FILE; break;
  }
  fs.readFile(toFile, 'utf8', function readFileCallback(err, data){
      if (err){
        console.log(err);
        callback(err);
      } else {
        const obj = JSON.parse(data);
        const lastBlock = obj.blocks[obj.blocks.length - 1];
        const newBlock = generateNextBlock(lastBlock);
        let json = '';
        if (isValidNewBlock(newBlock, lastBlock)) {
          switch(contentType) {
            case ContentType.INFO:
              newBlock.data = lastBlock.data.slice();
              newBlock.data.push(content);
              obj.blocks.push(newBlock);
              json = JSON.stringify(obj);
              fs.writeFileSync(toFile, json, 'utf8');
              callback();
              break;
            case ContentType.REQUESTS:
              newBlock.data = lastBlock.data.slice();
              newBlock.data.push(content);
              obj.blocks.push(newBlock);
              json = JSON.stringify(obj);
              fs.writeFileSync(toFile, json, 'utf8');
              callback();
              break;
            case ContentType.CONFIRMATION:
              //delete request
              fs.readFile(REQUESTS_FILE, 'utf8', function readFileCallback(err, data1){
                if (err){
                  console.log(err);
                } else {
                  const requestsChain = JSON.parse(data1);
                  const lastRequestBlock = requestsChain.blocks[requestsChain.blocks.length - 1];
                  const newRequestBlock = generateNextBlock(lastRequestBlock);
                  if (isValidNewBlock(newRequestBlock, lastRequestBlock)) {
                    newRequestBlock.data = lastRequestBlock.data.filter((el) => !(el.toId === content.fromId && el.fromId === content.toId))
                    requestsChain.blocks.push(newRequestBlock);
                    const requestJson = JSON.stringify(requestsChain);
                    fs.writeFileSync(REQUESTS_FILE, requestJson, 'utf8');
                    //change confirmations
                    fs.readFile(CONFIRMATION_FILE, 'utf8', function readFileCallback(err, data2){
                      if (err) {
                        console.log(err);
                      } else {
                        console.log(content);
                          const confirmationChain = JSON.parse(data2);
                          const lastConfirmationBlock = Object.assign({}, confirmationChain.blocks[confirmationChain.blocks.length - 1]);
                          const newConfirmationBlock = generateNextBlock(lastConfirmationBlock);
                          let containsInConfirmationBlock = false;
                          lastConfirmationBlock.data.map((confirmationEl) => {
                            if (confirmationEl && confirmationEl.id === content.toId) {
                              containsInConfirmationBlock = true;
                              if (content.giveConfirmation) {
                                console.log("----GIVE CONFIRMATION----");
                                confirmationEl.confirmedIds.push(content.fromId);
                              } else {
                                console.log("----DELETE CONFIRMATION----");
                                const index = confirmationEl.confirmedIds.indexOf(content.fromId);
                                if (index >= 0) {
                                  confirmationEl.confirmedIds.splice(index, 1);
                                }
                                console.log(content.fromId, confirmationEl.confirmedIds);
                              }
                            }
                          });
                          newConfirmationBlock.data = lastConfirmationBlock.data.slice();
                          if (content.giveConfirmation && !containsInConfirmationBlock) {
                            newConfirmationBlock.data.push({id : content.toId, confirmedIds: [content.fromId]});
                          }

                          confirmationChain.blocks.push(newConfirmationBlock);
                          const confirmJSon = JSON.stringify(confirmationChain);
                          fs.writeFileSync(CONFIRMATION_FILE, confirmJSon, 'utf8');
                          callback();
                      }
                    });
                  }
                }
              });
              break;
          }
        }
      }
  });
};

const getChain = (contentType, callback) => {
  let inFile = '';
  switch(contentType) {
    case ContentType.CONFIRMATION: inFile = CONFIRMATION_FILE; break;
    case ContentType.REQUESTS: inFile = REQUESTS_FILE; break;
    case ContentType.INFO: inFile = INFO_FILE; break;
  }
  fs.readFile(inFile, 'utf8', (err, data) => {
      if (err){
        console.warn(err);
        callback(err);
      } else {
         callback(null, data);
      }
  });
}

const isValidNewBlock = (newBlock, previousBlock) => {
    if (previousBlock.index + 1 !== newBlock.index) {
        console.log('invalid index');
        return false;
    } else if (previousBlock.hash !== newBlock.previousHash) {
        console.log('invalid previoushash');
        return false;
    } else if (calculateHashForBlock(newBlock) !== newBlock.hash) {
        console.log(typeof (newBlock.hash) + ' ' + typeof calculateHashForBlock(newBlock));
        console.log('invalid hash: ' + calculateHashForBlock(newBlock) + ' ' + newBlock.hash);
        return false;
    }
    return true;
};

const connectToPeers = (newPeers) => {
    newPeers.forEach((peer) => {
        const ws = new WebSocket(peer);
        ws.on('open', () => initConnection(ws));
        ws.on('error', () => {
            console.log('connection failed')
        });
    });
};

const handleBlockchainResponse = (message) => {
    console.log('message', message);
    const receivedBlocks = JSON.parse(message.data).sort((b1, b2) => (b1.index - b2.index));
    const latestBlockReceived = receivedBlocks[receivedBlocks.length - 1];
    const latestBlockHeld = getLatestBlock(message.contentType);
    if (latestBlockReceived.index > latestBlockHeld.index) {
        console.log('blockchain possibly behind. We got: ' + latestBlockHeld.index + ' Peer got: ' + latestBlockReceived.index);
        if (latestBlockHeld.hash === latestBlockReceived.previousHash) {
            console.log("We can append the received block to our chain");
            addBlock(message.contentType, latestBlockReceived.data, () => {
              broadcast(responseLatestMsg(message.contentType));
            });
        } else if (receivedBlocks.length === 1) {
            console.log("We have to query the chain from our peer");
            broadcast(queryAllMsg(message.contentType));
        } else {
            console.log("Received blockchain is longer than current blockchain");
            replaceChain(receivedBlocks, message.contentType);
        }
    } else {
        console.log('received blockchain is not longer than current blockchain. Do nothing');
    }
};

const replaceChain = (newBlocks, contentType) => {
    let inFile = '';
    switch(contentType) {
      case ContentType.CONFIRMATION: inFile = CONFIRMATION_FILE; break;
      case ContentType.REQUESTS: inFile = REQUESTS_FILE; break;
      case ContentType.INFO: inFile = INFO_FILE; break;
    }
    fs.readFile(inFile, 'utf8', (err, data) => {
        if (err){
          console.log(err);
          return null;
        } else {
          const obj =  JSON.parse(data);
          if (isValidChain(newBlocks) && newBlocks.length > obj.blocks.length) {
              console.log('Received blockchain is valid. Replacing current blockchain with received blockchain');
              obj.blocks = newBlocks;
              const json = JSON.stringify(obj);
              fs.writeFileSync(inFile, json, 'utf8');
              broadcast(responseLatestMsg(contentType));
          } else {
              console.log('Received blockchain invalid');
          }
        }
    });
};

const isValidChain = (blockchainToValidate) => {
    // if (JSON.stringify(blockchainToValidate[0]) !== JSON.stringify(getGenesisBlock())) {
    //     return false;
    // }
    const tempBlocks = [blockchainToValidate[0]];
    for (let i = 1; i < blockchainToValidate.length; i++) {
        if (isValidNewBlock(blockchainToValidate[i], tempBlocks[i - 1])) {
            tempBlocks.push(blockchainToValidate[i]);
        } else {
            return false;
        }
    }
    return true;
};

const getLatestBlock = (contentType) => {
  let fromFile = '';
  switch(contentType) {
    case ContentType.CONFIRMATION: fromFile = CONFIRMATION_FILE; break;
    case ContentType.REQUESTS: fromFile = REQUESTS_FILE; break;
    case ContentType.INFO: fromFile = INFO_FILE; break;
  }
  console.log('get latest block ', fromFile);
  const content = fs.readFileSync(fromFile, 'utf8');
  if (!content) {
    console.log("not a content");
    return null;
  } else {
    const obj = JSON.parse(content);
    return obj.blocks[obj.blocks.length - 1];
  }
}
const queryChainLengthMsg = (contentType) => ({'type': MessageType.QUERY_LATEST, 'contentType': contentType});
const queryAllMsg = (contentType) => ({'type': MessageType.QUERY_ALL, 'contentType': contentType});
const responseChainMsg = (contentType) => {
  let fromFile = '';
  switch(contentType) {
    case ContentType.CONFIRMATION: fromFile = CONFIRMATION_FILE; break;
    case ContentType.REQUESTS: fromFile = REQUESTS_FILE; break;
    case ContentType.INFO: fromFile = INFO_FILE; break;
  }
  const content = fs.readFileSync(fromFile, 'utf8');
      if (!content){
        console.log('error', err);
        return {
            'type': MessageType.RESPONSE_BLOCKCHAIN, 'data': null, contentType: contentType
        };
      } else {
        const obj = JSON.parse(content);
        return {
            'type': MessageType.RESPONSE_BLOCKCHAIN, 'data': JSON.stringify(obj.blocks), contentType: contentType
        }
      }
}
const responseLatestMsg = (contentType) => ({
    'type': MessageType.RESPONSE_BLOCKCHAIN,
    'contentType': contentType,
    'data': JSON.stringify([getLatestBlock(contentType)])
});

const write = (ws, message) => ws.send(JSON.stringify(message));
const broadcast = (message) => sockets.forEach(socket => write(socket, message));


prepareData();
connectToPeers(initialPeers);
initHttpServer();
initP2PServer();
