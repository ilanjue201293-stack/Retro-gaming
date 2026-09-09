import RetroApp from "./RetroApp";
import RoomGameController from "./RoomGameController";
import DashboardGameLibraryEnhancer from "./DashboardGameLibraryEnhancer";
import BotUXEnhancer from "./BotUXEnhancer";

export default function Home() {
  return <>
    <RetroApp />
    <RoomGameController />
    <DashboardGameLibraryEnhancer />
    <BotUXEnhancer />
  </>;
}
