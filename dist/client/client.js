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
const mediasoup = require('mediasoup-client');
// const socketClient = require('socket.io-client');
const socketPromise = require('../../lib/socket.io-promise').promise;
const config = require('../config.js');
const socket_io_client_1 = __importDefault(require("socket.io-client"));
const hostname = window.location.hostname;
let device;
let socket;
let producer;
const $ = document.querySelector.bind(document);
const $fsPublish = $('#fs_publish');
const $fsSubscribe = $('#fs_subscribe');
const $btnConnect = $('#btn_connect');
const $btnWebcam = $('#btn_webcam');
const $btnScreen = $('#btn_screen');
const $btnSubscribe = $('#btn_subscribe');
const $chkSimulcast = $('#chk_simulcast');
const $txtConnection = $('#connection_status');
const $txtWebcam = $('#webcam_status');
const $txtScreen = $('#screen_status');
const $txtSubscription = $('#sub_status');
let $txtPublish;
$btnConnect.addEventListener('click', connect);
$btnWebcam.addEventListener('click', publish);
$btnScreen.addEventListener('click', publish);
$btnSubscribe.addEventListener('click', subscribe);
if (typeof navigator.mediaDevices.getDisplayMedia === 'undefined') {
    $txtScreen.innerHTML = 'Not supported';
    $btnScreen.disabled = true;
}
function connect() {
    return __awaiter(this, void 0, void 0, function* () {
        $btnConnect.disabled = true;
        $txtConnection.innerHTML = 'Connecting...';
        const opts = {
            path: '/server',
            transports: ['websocket'],
        };
        const serverUrl = `https://${hostname}:${config.listenPort}`;
        socket = socket_io_client_1.default(serverUrl, opts);
        socket.request = socketPromise(socket);
        socket.on('connect', () => __awaiter(this, void 0, void 0, function* () {
            $txtConnection.innerHTML = 'Connected';
            $fsPublish.disabled = false;
            $fsSubscribe.disabled = false;
            const data = yield socket.request('getRouterRtpCapabilities');
            yield loadDevice(data);
        }));
        socket.on('disconnect', () => {
            $txtConnection.innerHTML = 'Disconnected';
            $btnConnect.disabled = false;
            $fsPublish.disabled = true;
            $fsSubscribe.disabled = true;
        });
        socket.on('connect_error', (error) => {
            console.error('could not connect to %s%s (%s)', serverUrl, opts.path, error.message);
            $txtConnection.innerHTML = 'Connection failed';
            $btnConnect.disabled = false;
        });
        socket.on('newProducer', () => {
            $fsSubscribe.disabled = false;
        });
    });
}
function loadDevice(routerRtpCapabilities) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            device = new mediasoup.Device();
        }
        catch (error) {
            if (error.name === 'UnsupportedError') {
                console.error('browser not supported');
            }
        }
        yield device.load({ routerRtpCapabilities });
    });
}
function publish(e) {
    return __awaiter(this, void 0, void 0, function* () {
        const isWebcam = (e.target.id === 'btn_webcam');
        $txtPublish = isWebcam ? $txtWebcam : $txtScreen;
        const data = yield socket.request('createProducerTransport', {
            forceTcp: false,
            rtpCapabilities: device.rtpCapabilities,
        });
        if (data.error) {
            console.error(data.error);
            return;
        }
        const transport = device.createSendTransport(data);
        transport.on('connect', ({ dtlsParameters }, callback, errback) => __awaiter(this, void 0, void 0, function* () {
            socket.request('connectProducerTransport', { dtlsParameters })
                .then(callback)
                .catch(errback);
        }));
        transport.on('produce', ({ kind, rtpParameters }, callback, errback) => __awaiter(this, void 0, void 0, function* () {
            try {
                const { id } = yield socket.request('produce', {
                    transportId: transport.id,
                    kind,
                    rtpParameters,
                });
                callback({ id });
            }
            catch (err) {
                errback(err);
            }
        }));
        transport.on('connectionstatechange', (state) => {
            switch (state) {
                case 'connecting':
                    $txtPublish.innerHTML = 'publishing...';
                    $fsPublish.disabled = true;
                    $fsSubscribe.disabled = true;
                    break;
                case 'connected':
                    document.querySelector('#local_video').srcObject = stream;
                    $txtPublish.innerHTML = 'published';
                    $fsPublish.disabled = true;
                    $fsSubscribe.disabled = false;
                    break;
                case 'failed':
                    transport.close();
                    $txtPublish.innerHTML = 'failed';
                    $fsPublish.disabled = false;
                    $fsSubscribe.disabled = true;
                    break;
                default: break;
            }
        });
        let stream;
        try {
            stream = yield getUserMedia(transport, isWebcam);
            const track = stream.getVideoTracks()[0];
            const params = { track, encodings: [], codecOptions: null };
            if ($chkSimulcast.checked) {
                params.encodings = [
                    { maxBitrate: 100000 },
                    { maxBitrate: 300000 },
                    { maxBitrate: 900000 },
                ];
                params.codecOptions = {
                    videoGoogleStartBitrate: 1000
                };
            }
            producer = yield transport.produce(params);
        }
        catch (err) {
            $txtPublish.innerHTML = 'failed';
        }
    });
}
function getUserMedia(transport, isWebcam) {
    return __awaiter(this, void 0, void 0, function* () {
        if (!device.canProduce('video')) {
            console.error('cannot produce video');
            return;
        }
        try {
            return isWebcam
                ? (navigator.mediaDevices.getUserMedia({ video: true }))
                : (navigator.mediaDevices.getDisplayMedia({ video: true }));
        }
        catch (err) {
            console.error('getUserMedia() failed:', err.message);
            throw err;
        }
    });
}
function subscribe() {
    return __awaiter(this, void 0, void 0, function* () {
        const data = yield socket.request('createConsumerTransport', {
            forceTcp: false,
        });
        if (data.error) {
            console.error(data.error);
            return;
        }
        const transport = device.createRecvTransport(data);
        transport.on('connect', ({ dtlsParameters }, callback, errback) => {
            socket.request('connectConsumerTransport', {
                transportId: transport.id,
                dtlsParameters
            })
                .then(callback)
                .catch(errback);
        });
        transport.on('connectionstatechange', (state) => __awaiter(this, void 0, void 0, function* () {
            switch (state) {
                case 'connecting':
                    $txtSubscription.innerHTML = 'subscribing...';
                    $fsSubscribe.disabled = true;
                    break;
                case 'connected':
                    document.querySelector('#remote_video').srcObject = yield stream;
                    yield socket.request('resume');
                    $txtSubscription.innerHTML = 'subscribed';
                    $fsSubscribe.disabled = true;
                    break;
                case 'failed':
                    transport.close();
                    $txtSubscription.innerHTML = 'failed';
                    $fsSubscribe.disabled = false;
                    break;
                default: break;
            }
        }));
        const stream = consume(transport);
    });
}
function consume(transport) {
    return __awaiter(this, void 0, void 0, function* () {
        const { rtpCapabilities } = device;
        const data = yield socket.request('consume', { rtpCapabilities });
        const { producerId, id, kind, rtpParameters, } = data;
        let codecOptions = {};
        const consumer = yield transport.consume({
            id,
            producerId,
            kind,
            rtpParameters,
            codecOptions,
        });
        const stream = new MediaStream();
        stream.addTrack(consumer.track);
        return stream;
    });
}
