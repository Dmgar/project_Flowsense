import { useState } from 'react';

export function usePolicyChoices() {
  const [operatorReference, setOperatorReference] = useState('');
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [privacyAcknowledged, setPrivacyAcknowledged] = useState(false);
  return { operatorReference, setOperatorReference, termsAccepted, setTermsAccepted, privacyAcknowledged, setPrivacyAcknowledged };
}
