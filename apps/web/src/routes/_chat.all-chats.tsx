import { createFileRoute } from "@tanstack/react-router";
import { AllChatsPage } from "../components/chatHub/AllChatsPage";
export const Route = createFileRoute("/_chat/all-chats")({ component: AllChatsPage });
