package org.cbj.webrtc.signal.controller;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.cbj.webrtc.signal.dto.SignalMessage;
import org.springframework.messaging.handler.annotation.MessageMapping;
import org.springframework.messaging.handler.annotation.Payload;
import org.springframework.messaging.handler.annotation.SendTo;
import org.springframework.messaging.simp.SimpMessageHeaderAccessor;
import org.springframework.web.bind.annotation.RestController;

import java.util.*;
import java.util.concurrent.ConcurrentHashMap;

@Slf4j
@RestController
@RequiredArgsConstructor
public class SignalingController {

    private final Set<String> activeUsers = ConcurrentHashMap.newKeySet();

    @MessageMapping("/message")
    @SendTo("/topic/message")
    public SignalMessage signaling(@Payload SignalMessage message, SimpMessageHeaderAccessor headerAccessor) {
        log.info("### SignalingController.signaling");

        if ("join".equals(message.getType())) {
            String newUser = message.getSender();
            if (activeUsers.add(newUser)) {
                List<String> sortedUsers = new ArrayList<>(activeUsers);
                Collections.sort(sortedUsers);
                List<List<String>> offers = new ArrayList<>();
                for (String existingUser : sortedUsers) {
                    if (!existingUser.equals(newUser)) {
                        offers.add(List.of(existingUser, newUser));
                    }
                }
                Map<String, Object> resetData = new HashMap<>();
                resetData.put("users", sortedUsers);
                resetData.put("offers", offers);
                log.info("### join users = {}",sortedUsers);
                log.info("### join offers = {}",offers);
                return new SignalMessage("new_user", "server", null, null, resetData);
            }
        } else if ("leave".equals(message.getType())) {
            String leavingUser = message.getSender();
            if (activeUsers.remove(leavingUser)) {
                List<String> sortedUsers = new ArrayList<>(activeUsers);
                Collections.sort(sortedUsers);

                log.info("✅ User left - users: {}", sortedUsers);

                Map<String, Object> resetData = new HashMap<>();
                resetData.put("users", sortedUsers);
                resetData.put("offers", Collections.emptyList());
                log.info("### left users = {}",sortedUsers);

                return new SignalMessage("user_left", "server", null, null, resetData);
            }
        }

        return message;
    }
}
