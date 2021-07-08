"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const config_js_1 = __importDefault(require("../config.js"));
const mediasoup = require('mediasoup');
const fs = require('fs');
const https = require('https');
const socketIO = require('socket.io');
// Global variables
let worker;
let webServer;
let socketServer;
let expressApp;
let producer;
let consumer;
let producerTransport;
let consumerTransport;
let mediasoupRouter;
(() => __awaiter(void 0, void 0, void 0, function* () {
    try {
        yield runExpressApp();
        yield runWebServer();
        yield runSocketServer();
        yield runMediasoupWorker();
    }
    catch (err) {
        console.error(err);
    }
}))();
function runExpressApp() {
    return __awaiter(this, void 0, void 0, function* () {
        expressApp = express_1.default();
        expressApp.use(express_1.default.json());
        expressApp.use(express_1.default.static(__dirname));
        expressApp.use((error, req, res, next) => {
            if (error) {
                console.warn('Express app error,', error.message);
                error.status = error.status || (error.name === 'TypeError' ? 400 : 500);
                res.statusMessage = error.message;
                res.status(error.status).send(String(error));
            }
            else {
                next();
            }
        });
    });
}
function runWebServer() {
    return __awaiter(this, void 0, void 0, function* () {
        const { sslKey, sslCrt } = config_js_1.default;
        if (!fs.existsSync(sslKey) || !fs.existsSync(sslCrt)) {
            console.error('SSL files are not found. check your config.js file');
            process.exit(0);
        }
        const tls = {
            cert: fs.readFileSync(sslCrt),
            key: fs.readFileSync(sslKey),
        };
        webServer = https.createServer(tls, expressApp);
        webServer.on('error', (err) => {
            console.error('starting web server failed:', err.message);
        });
        yield new Promise((resolve) => {
            const { listenIp, listenPort } = config_js_1.default;
            webServer.listen(listenPort, listenIp, () => {
                const listenIps = config_js_1.default.mediasoup.webRtcTransport.listenIps[0];
                const ip = listenIps.announcedIp || listenIps.ip;
                console.log('server is running');
                console.log(`open https://${ip}:${listenPort} in your web browser`);
                resolve(undefined);
            });
        });
    });
}
function runSocketServer() {
    return __awaiter(this, void 0, void 0, function* () {
        socketServer = socketIO(webServer, {
            serveClient: false,
            path: '/server',
            log: false,
        });
        socketServer.on('connection', (socket) => {
            console.log('client connected');
            // inform the client about existence of producer
            if (producer) {
                socket.emit('newProducer');
            }
            socket.on('disconnect', () => {
                console.log('client disconnected');
            });
            socket.on('connect_error', (err) => {
                console.error('client connection error', err);
            });
            socket.on('getRouterRtpCapabilities', (data, callback) => {
                callback(mediasoupRouter.rtpCapabilities);
            });
            socket.on('createProducerTransport', (data, callback) => __awaiter(this, void 0, void 0, function* () {
                try {
                    const { transport, params } = yield createWebRtcTransport();
                    producerTransport = transport;
                    callback(params);
                }
                catch (err) {
                    console.error(err);
                    callback({ error: err.message });
                }
            }));
            socket.on('createConsumerTransport', (data, callback) => __awaiter(this, void 0, void 0, function* () {
                try {
                    const { transport, params } = yield createWebRtcTransport();
                    consumerTransport = transport;
                    callback(params);
                }
                catch (err) {
                    console.error(err);
                    callback({ error: err.message });
                }
            }));
            socket.on('connectProducerTransport', (data, callback) => __awaiter(this, void 0, void 0, function* () {
                yield producerTransport.connect({ dtlsParameters: data.dtlsParameters });
                callback();
            }));
            socket.on('connectConsumerTransport', (data, callback) => __awaiter(this, void 0, void 0, function* () {
                yield consumerTransport.connect({ dtlsParameters: data.dtlsParameters });
                callback();
            }));
            socket.on('produce', (data, callback) => __awaiter(this, void 0, void 0, function* () {
                const { kind, rtpParameters } = data;
                producer = yield producerTransport.produce({ kind, rtpParameters });
                callback({ id: producer.id });
                // inform clients about new producer
                socket.broadcast.emit('newProducer');
            }));
            socket.on('consume', (data, callback) => __awaiter(this, void 0, void 0, function* () {
                callback(yield createConsumer(producer, data.rtpCapabilities));
            }));
            socket.on('resume', (data, callback) => __awaiter(this, void 0, void 0, function* () {
                yield consumer.resume();
                callback();
            }));
        });
    });
}
function runMediasoupWorker() {
    return __awaiter(this, void 0, void 0, function* () {
        worker = yield mediasoup.createWorker({
            logLevel: config_js_1.default.mediasoup.worker.logLevel,
            logTags: config_js_1.default.mediasoup.worker.logTags,
            rtcMinPort: config_js_1.default.mediasoup.worker.rtcMinPort,
            rtcMaxPort: config_js_1.default.mediasoup.worker.rtcMaxPort,
        });
        worker.on('died', () => {
            console.error('mediasoup worker died, exiting in 2 seconds... [pid:%d]', worker.pid);
            setTimeout(() => process.exit(1), 2000);
        });
        const mediaCodecs = config_js_1.default.mediasoup.router.mediaCodecs;
        mediasoupRouter = yield worker.createRouter({ mediaCodecs });
    });
}
function createWebRtcTransport() {
    return __awaiter(this, void 0, void 0, function* () {
        const { maxIncomingBitrate, initialAvailableOutgoingBitrate } = config_js_1.default.mediasoup.webRtcTransport;
        const transport = yield mediasoupRouter.createWebRtcTransport({
            listenIps: config_js_1.default.mediasoup.webRtcTransport.listenIps,
            enableUdp: true,
            enableTcp: true,
            preferUdp: true,
            initialAvailableOutgoingBitrate,
        });
        if (maxIncomingBitrate) {
            try {
                yield transport.setMaxIncomingBitrate(maxIncomingBitrate);
            }
            catch (error) {
            }
        }
        return {
            transport,
            params: {
                id: transport.id,
                iceParameters: transport.iceParameters,
                iceCandidates: transport.iceCandidates,
                dtlsParameters: transport.dtlsParameters
            },
        };
    });
}
function createConsumer(producer, rtpCapabilities) {
    return __awaiter(this, void 0, void 0, function* () {
        if (!mediasoupRouter.canConsume({
            producerId: producer.id,
            rtpCapabilities,
        })) {
            console.error('can not consume');
            return;
        }
        try {
            consumer = yield consumerTransport.consume({
                producerId: producer.id,
                rtpCapabilities,
                paused: producer.kind === 'video',
            });
        }
        catch (error) {
            console.error('consume failed', error);
            return;
        }
        if (consumer.type === 'simulcast') {
            yield consumer.setPreferredLayers({ spatialLayer: 2, temporalLayer: 2 });
        }
        return {
            producerId: producer.id,
            id: consumer.id,
            kind: consumer.kind,
            rtpParameters: consumer.rtpParameters,
            type: consumer.type,
            producerPaused: consumer.producerPaused
        };
    });
}
