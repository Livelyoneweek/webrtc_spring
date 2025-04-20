package org.cbj.webrtc.config;

import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Configuration;
import org.springframework.messaging.simp.config.MessageBrokerRegistry;
import org.springframework.web.socket.config.annotation.EnableWebSocketMessageBroker;
import org.springframework.web.socket.config.annotation.StompEndpointRegistry;
import org.springframework.web.socket.config.annotation.WebSocketMessageBrokerConfigurer;

@Configuration
@EnableWebSocketMessageBroker
@Slf4j
public class WebSocketConfig implements WebSocketMessageBrokerConfigurer {

    @Value("${websocket.endpoint}")
    private String websocketEndpoint; // /ws 임

    @Override
    public void configureMessageBroker(MessageBrokerRegistry config) {
        config.enableSimpleBroker("/topic"); //sub 하는 클라이언트에게 메시지 전달 (클라이언트가 채널구독할시 /topic/**)
        config.setApplicationDestinationPrefixes("/app");  //클라이언트의 send 요청 처리 (클라이언트는 /app/** 으로 메시지 요청)
    }

    @Override
    public void registerStompEndpoints(StompEndpointRegistry registry) {
        log.info("### websocketEndpoint = {}",websocketEndpoint);
        registry.addEndpoint(websocketEndpoint)
                .setAllowedOriginPatterns("*") // 개발 중엔 허용
                .withSockJS();
    }
}
