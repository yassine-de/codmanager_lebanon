export const features = {
  whatsapp: false,
  whatsappAi: false,
  whatsappCampaigns: false,
  followUps: false,
  agentAssignment: true,
  freightForwarder: false,
  orioSync: false,

  dashboard: true,
  orders: true,
  products: true,
  invoices: true,
  sellers: true,
  settings: true,
  analytics: true,
  sourcing: true,
  support: true,
  alerts: true,
  sellerSheets: true,
  wakilniSync: false,
} as const;

export type FeatureKey = keyof typeof features;

export function isFeatureEnabled(feature: FeatureKey) {
  return features[feature];
}
