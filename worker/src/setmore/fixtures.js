// Mock Setmore data for SETMORE_MOCK_MODE=true.
//
// Shapes follow the live v2 responses observed in probe runs 44989221725
// and 44990258119 (ARCHITECTURE §5, §6.2). Service names, prices and
// durations are the 44 services on the public Setmore page (read
// 2026-11-22). Ids are placeholders, never real Setmore ids.

export const MOCK_ACCOUNT_ID = 'acc_mock';
export const MOCK_PROVIDER_ID = 'staff_riri';
export const MOCK_NON_PROVIDER_ID = 'staff_studio';
export const MOCK_HOURS = { open: '10:00', close: '17:00', closedWeekdays: ['Sunday'] };

export function slugId(prefix, title) {
  return `${prefix}_${title.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')}`;
}

// [category title, [[service title, cost USD, duration minutes], ...]]
const CATALOG = [
  ['Permanent Makeup', [
    ['Lip Blushing', 475, 180], ['Ombre Powder Eyebrows', 475, 180], ['Eyeliner Tattoo', 345, 120],
    ['Lash Line Tattoo', 285, 90], ['Bottom Eyeliner Tattoo', 185, 90], ['Lip Blushing Touch-Up', 200, 90],
    ['Ombre Powder Eyebrows Touch-Up', 200, 90], ['Eyeliner Touch-Up', 150, 60], ['Lash Line Touch-Up', 135, 60],
    ['Bottom Eyeliner Touch-Up', 120, 60]
  ]],
  ['Eyelash Extensions', [
    ['Classic Full Extension', 165, 120], ['Hybrid Full Extension 2D-3D', 180, 120],
    ['Volume Full Extension 4D-5D', 190, 150], ['MEGA Volume Full Extension 8D-10D', 225, 150],
    ['Wet Effect Full Extension', 180, 120], ['Lash Removal', 30, 30]
  ]],
  ['Wispy Eyelashes', [
    ['Classic Wispy', 175, 120], ['Hybrid Wispy', 190, 120], ['Volume Wispy', 200, 150], ['MEGA Volume Wispy', 235, 150]
  ]],
  ['Lash Lift', [['Lash Lift + Tinting', 140, 90], ['Lash Lift', 115, 60]]],
  ['Eyebrow Services', [
    ['Eyebrow Lamination + Tinting + Shaping', 130, 90], ['Eyebrow Lamination', 85, 30],
    ['Eyebrow Tint + Shaping', 95, 60], ['Eyebrow Shaping', 45, 30]
  ]],
  ['Eyelash Refills', [
    ['Classic Refill 2 Weeks', 90, 60], ['Classic Refill 3 Weeks', 115, 90], ['Hybrid Refill 2 Weeks', 110, 90],
    ['Hybrid Refill 3 Weeks', 120, 90], ['Volume Refill 2 Weeks', 120, 90], ['Volume Refill 3 Weeks', 130, 90],
    ['MEGA Volume Refill 2 Weeks', 130, 120], ['MEGA Volume Refill 3 Weeks', 140, 120],
    ['Wet Effect Refill 2 Weeks', 115, 90], ['Wet Effect Refill 3 Weeks', 130, 90]
  ]],
  ['Wispy Refills', [
    ['Classic Wispy Refill 2 Weeks', 100, 90], ['Classic Wispy Refill 3 Weeks', 125, 90],
    ['Hybrid Wispy Refill 2 Weeks', 120, 90], ['Hybrid Wispy Refill 3 Weeks', 130, 120],
    ['Volume Wispy Refill 2 Weeks', 130, 120], ['Volume Wispy Refill 3 Weeks', 140, 120],
    ['MEGA Volume Wispy Refill 2 Weeks', 140, 120], ['MEGA Volume Wispy Refill 3 Weeks', 150, 120]
  ]]
];

export const MOCK_CATEGORIES = CATALOG.map(([title, services]) => ({
  id: slugId('cat', title),
  account_id: MOCK_ACCOUNT_ID,
  title,
  service_ids: services.map(([serviceTitle]) => slugId('svc', serviceTitle)),
  visibility: 'PUBLIC'
}));

export const MOCK_SERVICES = CATALOG.flatMap(([categoryTitle, services]) => services.map(([title, cost, duration]) => ({
  id: slugId('svc', title),
  account_id: MOCK_ACCOUNT_ID,
  title,
  provider_ids: [MOCK_PROVIDER_ID],
  type: 'SERVICE',
  cost,
  duration,
  color_code: '#b99a6d',
  buffer: { before: 0, after: 0 },
  visibility: 'PUBLIC',
  location: {},
  category_ids: [slugId('cat', categoryTitle)],
  currency: 'USD'
})));

export const MOCK_STAFF = [
  {
    id: MOCK_PROVIDER_ID, first_name: 'Riri', last_name: '', avatar_url: '',
    phone_numbers: [], email_addresses: [], urls: {}, social: {}, custom_fields: {}
  },
  {
    id: MOCK_NON_PROVIDER_ID, avatar_url: '', phone_numbers: [], email_addresses: [],
    urls: {}, social: {}, location: {}, custom_fields: {}
  }
];
