package org.cbj.webrtc.signal.dto;

import lombok.AllArgsConstructor;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.ToString;

@Getter
@AllArgsConstructor
@NoArgsConstructor
@ToString
public class SignalMessage {
    private String type;       // offer, answer, candidate, join, leave 등
    private String sender;     // 보내는 사람 닉네임
    private String roomId;     // 방 번호 (방 개념 도입 예정)
    private String target;     // 특정 대상 유저 (필요 시)
    private Object data;       // SDP, ICE 등 페이로드
}
