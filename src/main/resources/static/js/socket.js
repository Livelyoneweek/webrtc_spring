let stompClient;
let localStream;
const pcs = {};       // { peerName: RTCPeerConnection }
const iceQueues = {}; // { peerName: [RTCIceCandidateInit, …] }
let username = "";

const config = {
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
};

window.connect = connect;

/**
 * 1. 페이지에서 “연결” 버튼 클릭 시 호출
 *    - 사용자 미디어 획득
 *    - STOMP/SockJS 연결 및 join 신호 전송
 */
async function connect() {
    username = document.getElementById("username").value.trim();
    if (!username) {
        return alert("닉네임을 입력해주세요");
    }

    try {
        // 내 카메라·마이크 스트림 얻기
        localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        document.getElementById("localVideo").srcObject = localStream;
    } catch (err) {
        return console.error("getUserMedia 실패:", err);
    }

    // SockJS + STOMP로 시그널링 서버 연결
    stompClient = Stomp.over(new SockJS("/ws"));
    stompClient.connect({}, () => {
        console.log("[connect] STOMP 연결 성공, join 전송");
        // 메시지 구독
        stompClient.subscribe("/topic/message", ({ body }) => {
            const msg = JSON.parse(body);
            if (msg.sender === username) return;
            handleSignal(msg);
        });
        // 서버에 join 요청
        stompClient.send("/app/message", {}, JSON.stringify({
            type: "join",
            sender: username
        }));
    });
}

/**
 * 2. 서버로부터 들어오는 모든 시그널링 메시지 처리
 */
async function handleSignal(msg) {
    const { type, sender, target, data } = msg;

    if (type === "new_user") {
        // 새 유저 진입: 서버가 보낸 offers 배열을 보고 내가 offer 보낼 대상을 결정
        console.log("[new_user] users:", data.users, "offers:", data.offers);
        for (const [from, to] of data.offers) {
            if (from === username) {
                console.log(`[new_user] offer 생성 -> ${to}`);
                await createOffer(to);
            }
        }

    } else if (type === "offer" && target === username) {
        // Offer 수신 시 → Answer 생성
        console.log(`[offer] from ${sender}`);
        const pc = getPC(sender);

        // 1) 원격 SDP 설정
        await pc.setRemoteDescription(new RTCSessionDescription(data));
        // 2) 큐에 쌓인 ICE 모두 추가
        drainIce(sender);

        // 3) Answer 생성 및 전송
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        console.log(`[offer] answer 전송 -> ${sender}`);
        stompClient.send("/app/message", {}, JSON.stringify({
            type: "answer",
            sender: username,
            target: sender,
            data: pc.localDescription
        }));

    } else if (type === "answer" && target === username) {
        // Answer 수신 시 → 원격 SDP 설정
        console.log(`[answer] from ${sender}`);
        const pc = pcs[sender];
        if (!pc) return console.warn("알 수 없는 answer from", sender);
        await pc.setRemoteDescription(new RTCSessionDescription(data));
        drainIce(sender);

    } else if (type === "candidate" && target === username) {
        // ICE candidate 수신 시 → 즉시 추가 or 큐잉
        const pc = pcs[sender];
        if (pc && pc.remoteDescription && pc.remoteDescription.type) {
            console.log(`[candidate] 즉시 add -> ${sender}`);
            await pc.addIceCandidate(new RTCIceCandidate(data));
        } else {
            console.log(`[candidate] 큐잉 -> ${sender}`);
            iceQueues[sender].push(data);
        }

    } else if (type === "user_left") {
        // 유저 퇴장 시 필요한 PeerConnection 정리
        console.log("[user_left] 남은 유저:", msg.data.users);
        Object.keys(pcs).forEach(peer => {
            if (!msg.data.users.includes(peer)) {
                cleanupPeer(peer);
            }
        });
    }
}

/**
 * 3. Offer 생성 & 전송
 * @param {string} peer - 대상 유저명
 */
async function createOffer(peer) {
    const pc = getPC(peer);

    // 1) Offer SDP 생성
    const offer = await pc.createOffer();
    // 2) 내 SDP 로컬 설정 → ICE 수집 시작
    await pc.setLocalDescription(offer);

    console.log(`[createOffer] offer 전송 -> ${peer}`);
    // 3) STOMP로 전송
    stompClient.send("/app/message", {}, JSON.stringify({
        type: "offer",
        sender: username,
        target: peer,
        data: pc.localDescription
    }));
}

/**
 * 4. 큐에 쌓인 ICE 후보자 모두 추가
 * @param {string} peer - 대상 유저명
 */
function drainIce(peer) {
    console.log(`[drainIce] ${peer} 후보자 추가:`, iceQueues[peer]);
    const pc = pcs[peer];
    iceQueues[peer].forEach(c => pc.addIceCandidate(new RTCIceCandidate(c)).catch(console.error));
    iceQueues[peer] = [];
}

/**
 * 5. RTCPeerConnection 생성 또는 기존 인스턴스 반환
 * @param {string} peer - 대상 유저명
 * @returns {RTCPeerConnection}
 */
function getPC(peer) {
    if (pcs[peer]) return pcs[peer];

    console.log(`[getPC] 새 PeerConnection 생성 for ${peer}`);
    const pc = new RTCPeerConnection(config);
    pcs[peer] = pc;
    iceQueues[peer] = [];

    // --- 이벤트 핸들러 등록 ---

    // ICE 후보자 발견 시 호출
    pc.onicecandidate = ({ candidate }) => {
        if (candidate) {
            console.log(`[onicecandidate] ${peer} -> 전송`);
            stompClient.send("/app/message", {}, JSON.stringify({
                type: "candidate",
                sender: username,
                target: peer,
                data: candidate
            }));
        }
    };

    // 원격 트랙(stream) 수신 시 호출
    pc.ontrack = ({ streams: [stream] }) => {
        console.log(`[ontrack] 스트림 수신 for ${peer}`);
        let vid = document.getElementById(`remote-${peer}`);
        if (!vid) {
            // 동적 <video> 엘리먼트 생성
            vid = document.createElement("video");
            vid.id = `remote-${peer}`;
            vid.autoplay = true;
            vid.playsInline = true;
            vid.style.width = "300px";
            vid.style.border = "1px solid #ccc";
            document.getElementById("remoteVideos").appendChild(vid);
        }
        vid.srcObject = stream;
    };

    // 내 미디어 트랙을 페어 연결에 추가
    localStream.getTracks().forEach(track => pc.addTrack(track, localStream));

    return pc;
}

/**
 * 6. PeerConnection 종료 및 엘리먼트 정리
 * @param {string} peer - 대상 유저명
 */
function cleanupPeer(peer) {
    console.log(`[cleanupPeer] ${peer} 연결 종료 및 정리`);
    pcs[peer]?.close();
    delete pcs[peer];
    delete iceQueues[peer];
    document.getElementById(`remote-${peer}`)?.remove();
}