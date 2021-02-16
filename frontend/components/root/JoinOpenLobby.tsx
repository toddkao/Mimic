import { default as React, useState } from "react";
import { observer } from "mobx-react";
import { Image, ScrollView, Text, TouchableWithoutFeedback, View } from "react-native";
import styled from "styled-components/native";
import store, { Friend, Party } from "../../stores/friends-list-store";
import RootSubview from "./RootSubview";
import { profileIconPath } from "../../utils/assets";
import ABImage from "../assets/ABImage";

function NoOpenLobbies() {
    return (
        <NoOpenLobbiesContainer>
            <Poro source={require("../../assets/poros/poro-sad.png")} />
            <NoOpenLobbiesText>Nobody in your friends list is hosting an open lobby right now.</NoOpenLobbiesText>
        </NoOpenLobbiesContainer>
    );
}

function JoinLobbyButton({ onPress }: { onPress: any }) {
    const [isHover, setHover] = useState(false);
    const image = isHover
        ? require("../../assets/icons/open-party-join-active.png")
        : require("../../assets/icons/open-party-join.png");

    return (
        <TouchableWithoutFeedback
            onPressIn={() => setHover(true)}
            onPressOut={() => setHover(false)}
            onPress={() => (setHover(false), onPress())}>
            <JoinButton source={image} />
        </TouchableWithoutFeedback>
    );
}

const Lobby = observer(({ friend }: { friend: Friend }) => {
    const party: Party = JSON.parse(friend.lol!.pty!);
    const queue = store.queues.find(x => x.id === party.queueId)!;
    if (!queue) return <></>;
    const text = `${party.summoners.length}/${queue.maximumParticipantListSize} - ${queue.shortName}`;
    const avatarURL = profileIconPath(friend.icon);

    return (
        <LobbyContainer>
            <Avatar path={avatarURL} />
            <NameAndStatus>
                <Name>{friend.name}</Name>
                <Status>{text}</Status>
            </NameAndStatus>
            <JoinLobbyButton onPress={() => store.joinFriend(friend)} />
        </LobbyContainer>
    );
});

const OpenLobbies = observer(() => {
    if (!store.friendsWithParties.length) {
        return <NoOpenLobbies />;
    }

    return (
        <LobbiesContainer>
            {store.friendsWithParties.map(x => (
                <Lobby friend={x} key={x.name} />
            ))}
        </LobbiesContainer>
    );
});

export default function JoinOpenLobby({ onClose }: { onClose: Function }) {
    return (
        <RootSubview onClose={onClose} title="Join Open Lobby">
            <OpenLobbies />
        </RootSubview>
    );
}

const NoOpenLobbiesContainer = styled(View)`
    width: 100%;
    flex: 1;
    flex-direction: column;
    align-items: center;
    justify-content: center;
`;

const NoOpenLobbiesText = styled(Text)`
    text-align: center;
    width: 80%;
    font-family: "LoL Body";
    font-size: 16px;
    color: #aaaea0;
    margin-top: 30px;
`;

const Poro = styled(Image)`
    width: 160px;
    height: 160px;
`;

const LobbiesContainer = styled(ScrollView)`
    width: 100%;
    flex: 1;
`;

const LobbyContainer = styled(View)`
    width: 100%;
    padding: 10px;
    border: 0px solid rgba(255, 255, 255, 0.1);
    border-bottom-width: 1px;
    align-items: center;
    flex-direction: row;
`;

const NameAndStatus = styled(View)`
    flex: 1;
    flex-direction: column;
    margin-left: 10px;
`;

const Name = styled(Text)`
    font-family: "LoL Body";
    font-size: 18px;
    color: white;
`;

const Status = styled(Text)`
    font-family: "LoL Body";
    font-size: 16px;
    color: #09a646;
`;

const Avatar = styled(ABImage)`
    width: 40px;
    height: 40px;
    border-radius: 20px;
    border: 1px #ae8939;
`;

const JoinButton = styled(Image)`
    width: 35px;
    height: 35px;
    margin-right: 5px;
`;