package org.cbj.webrtc.signal.controller;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.cbj.webrtc.signal.dto.SignalMessage;
import org.springframework.messaging.handler.annotation.MessageMapping;
import org.springframework.messaging.handler.annotation.Payload;
import org.springframework.messaging.handler.annotation.SendTo;
import org.springframework.messaging.simp.SimpMessageHeaderAccessor;
import org.springframework.web.bind.annotation.RestController;

@Slf4j
@RestController
@RequiredArgsConstructor
public class SignalingController {

    // 클라이언트 → /app/signal 로 메시지 보내면
    @MessageMapping("/message")
    @SendTo("/topic/message")
    public SignalMessage signaling(@Payload SignalMessage message, SimpMessageHeaderAccessor headerAccessor) {
        log.info("📡 signal received: {}", message);
        return message;
    }
}
