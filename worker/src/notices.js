// FAQ notices a service can carry (services-meta.json `notice` key). The client
// shows a notice under the selected card; the booking must carry the client's
// confirmation and the server records it in the Setmore note.
export const NOTICES = {
  'lip-blushing-faq': { title: 'Lip Blushing & Cold Sores', label: 'Lip Blushing', faq_url: '/faq/#lip-blushing-cold-sores' },
  'lash-extensions-faq': { title: 'Lash Extensions', label: 'Lash Extensions', faq_url: '/faq/#faq-title-lash' },
  'lash-lift-faq': { title: 'Lash Lift', label: 'Lash Lift', faq_url: '/faq/#faq-title-lift' }
};

export function expandNotice(key) {
  const notice = key ? NOTICES[key] : null;
  return notice ? { key, ...notice } : null;
}
