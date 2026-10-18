import type { Corridor, Signal } from './types';

export const classLabels: Record<string, string> = { car: "Cars", motorcycle: "Motorcycles", bus: 'Buses', truck: "Trucks", bicycle: "Bicycles", pedestrian: "Pedestrians" };
export const classColors: Record<string, string> = { car: '#428363', motorcycle: '#c5933b', bus: '#688b78', truck: '#d07461', bicycle: '#8e7ca6', pedestrian: '#b5a24b' };
export const statusLabels: Record<string, string> = { new: "Review required", assigned: "Assigned", under_review: "Under review", confirmed: "Confirmed by operator", resolved: "Resolved", dismissed: "Dismissed" };
export const severityLabels = { low: "Low", medium: "Medium", high: "High" };
export const corridors: Corridor[] = [
  { id: 'harbor', name: 'Harbor Freeway · I-110', district: 'Downtown', length: 4.8, intersections: 12, congestion: .72, speed: 24, truck: 14, queue: 210, pedestrians: 2400, lat: 34.048, lng: -118.262 },
  { id: 'hollywood', name: 'Hollywood Freeway · US-101', district: 'Civic Center', length: 5.2, intersections: 14, congestion: .58, speed: 32, truck: 9, queue: 160, pedestrians: 1800, lat: 34.057, lng: -118.246 },
  { id: 'santa-monica', name: 'Santa Monica Freeway · I-10', district: 'South Park', length: 6.1, intersections: 16, congestion: .42, speed: 41, truck: 18, queue: 125, pedestrians: 920, lat: 34.027, lng: -118.275 },
];
export const signals: Signal[] = [
  { id: 'SIG-001', title: "Vehicle buildup", location: 'Wilshire Blvd · I-110', district: 'Downtown', type: "Congestion", severity: 'high', confidence: .92, impact: 180, evidence: "42 min · illustrative delay", duration: 12, lat: 34.0517, lng: -118.2599, action: "Review demand and access coordination.", owner: "Traffic operations", cameraIndex: 1, causes: ["High peak-hour demand", "Concentrated corridor entries", "Possible downstream restriction"] },
  { id: 'SIG-002', title: "Heavy vehicle pressure", location: '7th St · Harbor Freeway', district: 'Downtown', type: "Freight", severity: 'medium', confidence: .87, impact: 80, evidence: "1.8× · freight volume", duration: 8, lat: 34.0504, lng: -118.2619, action: "Check freight vehicle occupancy and access.", owner: "Freight and road space", cameraIndex: 2, causes: ["Heavy vehicle concentration", "Possible access buildup"] },
  { id: 'SIG-003', title: "Pedestrian crossing demand", location: 'Grand Ave · Civic Center', district: 'Civic Center', type: "Pedestrians", severity: 'high', confidence: .90, impact: 250, evidence: "320 pedestrians/h · example", duration: 5, lat: 34.0558, lng: -118.2468, action: "Review crossing times and accessibility.", owner: "Road safety", cameraIndex: 4, causes: ["Activity near the civic center", "Limited crossing window"] },
  { id: 'SIG-004', title: "Stopped vehicle", location: 'James M. Wood Blvd · I-110', district: 'Westlake', type: "Stopped vehicle", severity: 'high', confidence: .89, impact: 120, evidence: "3 km/h · illustrative signal", duration: 11, lat: 34.048, lng: -118.265, action: "Inspect the evidence before confirming an obstruction.", owner: "Field team", cameraIndex: 3, causes: ["Temporary stop", "Possible breakdown or merging maneuver"] },
  { id: 'SIG-005', title: "Traffic signal phase imbalance", location: 'Figueroa St · Olympic Blvd', district: 'South Park', type: "Traffic signals", severity: 'medium', confidence: .78, impact: 90, evidence: "+35% · estimated phase", duration: 9, lat: 34.0444, lng: -118.2645, action: "Request a review of the coordination plan.", owner: "Signal operations", cameraIndex: 5, causes: ["Asymmetric demand", "Possible scheduling mismatch"] },
  { id: 'SIG-006', title: "Recurring access queue", location: '6th St · Harbor Freeway', district: 'Downtown', type: "Congestion", severity: 'low', confidence: .76, impact: 60, evidence: "6 events · scenario", duration: 7, lat: 34.051649, lng: -118.259584, action: "Observe the access point and record recurrence.", owner: "Traffic operations", cameraIndex: 0, causes: ["Concentrated merging", "Limited access capacity"] },
  { id: 'SIG-007', title: "Bus corridor delay", location: 'Broadway · 4th St', district: 'Downtown', type: "Public transit", severity: 'medium', confidence: .81, impact: 110, evidence: "14 min · illustrative trip", duration: 10, lat: 34.049, lng: -118.249, action: "Review traffic continuity and stops.", owner: "Public mobility", cameraIndex: 6, causes: ["Nearby stops", "Interference from general traffic"] },
  { id: 'SIG-008', title: "Crossing interaction", location: 'Hope St · 9th St', district: 'South Park', type: "Potential conflict", severity: 'low', confidence: .72, impact: 40, evidence: "1.3× · demand", duration: 4, lat: 34.0458, lng: -118.262, action: "Review aggregate trajectories without identifying people.", owner: "Road safety", cameraIndex: 7, causes: ["Simultaneous turning movements", "High pedestrian demand"] },
];
export const hours = ['00', '02', '04', '06', '08', '10', '12', '14', '16', '18', '20', '22'];
const congestion = [.10, .08, .17, .36, .77, .62, .34, .31, .48, .84, .63, .26];
export function trendSeries(factor = 1) { return hours.map((hour, i) => ({ hour, current: Math.round(congestion[i] * factor * 100) / 100, baseline: Math.round(congestion[i] * 68) / 100, speed: Math.round(50 - congestion[i] * factor * 35), speed_baseline: Math.round(50 - congestion[i] * .68 * 35), pedestrians: Math.round(160 + congestion[i] * factor * 1620), conflicts: Math.round(3 + congestion[i] * factor * 18) })); }
export const demoSteps = [
  { title: "The city at a glance", detail: "Explore layers and prioritize review locations.", route: '/overview' },
  { title: "Understand a corridor", detail: "Compare the trend and illustrative baseline.", route: '/corridors/harbor' },
  { title: "From signal to priority", detail: "Select a hotspot and open its evidence.", route: '/hotspots' },
  { title: "Public camera evidence", detail: "Query a real Caltrans image and its detections.", route: '/cameras/caltrans-d7-1002' },
  { title: "People make the decision", detail: "Assign and review a case before confirming it.", route: '/risk-signals' },
  { title: "Emergency continuity", detail: "Calculate a real corridor with an alternative.", route: '/emergency-corridor' },
  { title: "Close the loop", detail: "Export the report and explain the system.", route: '/reports' },
];
