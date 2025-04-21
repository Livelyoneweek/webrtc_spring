let stompClient;
let localStream;
const pcs = {};           // { peerName: RTCPeerConnection }
const iceQueues = {};     // { peerName: [candidate, …] }
let username = "";

const config = { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] };

window.connect = connect;

async function connect() {
    username = document.getElementById("username").value.trim();
    if (!username) return alert("닉네임을 입력해주세요");

    console.log("[connect] getUserMedia 시작");
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    document.getElementById("localVideo").srcObject = localStream;

    stompClient = Stomp.over(new SockJS("/ws"));
    stompClient.connect({}, () => {
        console.log("[connect] STOMP 연결 완료, join 전송");
        stompClient.subscribe("/topic/message", ({ body }) => {
            const msg = JSON.parse(body);
            if (msg.sender === username) return;
            console.log("[signal recv]", msg);
            handleSignal(msg);
        });
        stompClient.send("/app/message", {}, JSON.stringify({
            type: "join", sender: username
        }));
    });
}

function handleSignal(msg) {
    const { type, sender, target, data } = msg;

    if (type === "new_user") {
        console.log("[new_user] users:", data.users, "offers:", data.offers);
        // 서버에서 주는 offers 리스트만 보고 offer 생성
        data.offers.forEach(([from, to]) => {
            if (from === username) {
                console.log(`[new_user] 내가 offer 보냄 -> ${to}`);
                createOffer(to);
            }
        });

    } else if (type === "offer" && target === username) {
        console.log(`[offer] from ${sender}`);
        const pc = getPC(sender);
        pc.setRemoteDescription(new RTCSessionDescription(data))
            .then(() => drainIce(sender))
            .then(() => pc.createAnswer())
            .then(ans => pc.setLocalDescription(ans))
            .then(() => {
                console.log(`[offer] answer 전송 -> ${sender}`);
                stompClient.send("/app/message", {}, JSON.stringify({
                    type: "answer", sender: username, target: sender, data: pc.localDescription
                }));
            }).catch(console.error);

    } else if (type === "answer" && target === username) {
        console.log(`[answer] from ${sender}`);
        const pc = pcs[sender];
        if (!pc) return console.warn("알 수 없는 answer from", sender);
        pc.setRemoteDescription(new RTCSessionDescription(data))
            .then(() => drainIce(sender))
            .catch(console.error);

    } else if (type === "candidate" && target === username) {
        const pc = pcs[sender];
        if (pc && pc.remoteDescription && pc.remoteDescription.type) {
            console.log(`[candidate] 즉시 add -> ${sender}`);
            pc.addIceCandidate(new RTCIceCandidate(data)).catch(console.error);
        } else {
            console.log(`[candidate] 큐잉 -> ${sender}`);
            iceQueues[sender].push(data);
        }

    } else if (type === "user_left") {
        console.log("[user_left] 재정리 대상:", msg.data.users);
        // 남은 유저 목록에 없는 peer 정리
        Object.keys(pcs).forEach(peer => {
            if (!msg.data.users.includes(peer)) cleanupPeer(peer);
        });
    }
}

function getPC(peer) {
    if (pcs[peer]) return pcs[peer];

    console.log(`[getPC] 새 PC 생성 for ${peer}`);
    const pc = new RTCPeerConnection(config);
    pcs[peer] = pc;
    iceQueues[peer] = [];

    localStream.getTracks().forEach(t => pc.addTrack(t, localStream));

    pc.onicecandidate = ({ candidate }) => {
        if (candidate) {
            console.log(`[onicecandidate] ${peer} -> 전송`);
            stompClient.send("/app/message", {}, JSON.stringify({
                type: "candidate", sender: username, target: peer, data: candidate
            }));
        }
    };

    pc.ontrack = ({ streams: [stream] }) => {
        let vid = document.getElementById(`remote-${peer}`);
        if (!vid) {
            vid = document.createElement("video");
            vid.id = `remote-${peer}`;
            vid.autoplay = true; vid.playsInline = true;
            vid.style.width = "300px"; vid.style.border = "1px solid #ccc";
            document.getElementById("remoteVideos").appendChild(vid);
        }
        console.log(`[ontrack] 스트림 붙임 for ${peer}`);
        vid.srcObject = stream;
    };

    return pc;
}

function createOffer(peer) {
    const pc = getPC(peer);
    return pc.createOffer()
        .then(off => pc.setLocalDescription(off))
        .then(() => {
            console.log(`[createOffer] ${peer} -> 전송`);
            stompClient.send("/app/message", {}, JSON.stringify({
                type: "offer", sender: username, target: peer, data: pc.localDescription
            }));
        }).catch(console.error);
}

function drainIce(peer) {
    console.log(`[drainIce] 큐 처리 for ${peer}`, iceQueues[peer]);
    const pc = pcs[peer];
    iceQueues[peer].forEach(c => pc.addIceCandidate(new RTCIceCandidate(c)).catch(console.error));
    iceQueues[peer] = [];
}

function cleanupPeer(peer) {
    console.log(`[cleanupPeer] ${peer} 정리`);
    pcs[peer]?.close();
    delete pcs[peer];
    delete iceQueues[peer];
    document.getElementById(`remote-${peer}`)?.remove();
}