// The meeting screen's panels, found by the agent tab's panel discovery (`@screens/*/tab-panel.ts`): the controls on a
// meeting agent's tab, and the Open channel switch inside every agent's tab.
import { createBrowserAudioCapture } from '../../audio';
import { channelSwitchPanel } from './channel-switch';
import { meetingPanel } from './controls-panel';
import { meetingAgents } from './meeting-agents';

export default [meetingPanel({ agents: meetingAgents, capture: createBrowserAudioCapture }), channelSwitchPanel()];
