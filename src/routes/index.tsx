import { createFileRoute } from "@tanstack/react-router";
import { StudyPage } from "@/components/study/StudyPage";

export const Route = createFileRoute("/")({ component: StudyPage });
