# FlowSense Cookie and Local Storage Notice

**Version:** 2026-10-24  
**Effective date:** October 24, 2026  
**Status:** Based on the repository implementation reviewed on this date; re-check production tags and hosting before launch.

## What this app uses

The inspected frontend does not set browser cookies for authentication, analytics, advertising, or tracking. It stores interface preferences in browser `localStorage` under the `flowsense-product-preferences` key. These preferences include view settings and saved camera or corridor references. You can remove them in the browser’s site-data settings; doing so resets those preferences.

The app loads map tiles from OpenStreetMap and OpenTopoMap and video from configured source providers. Those are network requests to third parties, not evidence that FlowSense itself sets a cookie. The browser sends normal connection information, such as its IP address and the requested tile or video URL, to deliver those resources. Third-party policies apply to those requests. This code review does not inspect cookies set by a production reverse proxy or by third-party responses, so the operator must verify deployed behavior.

## Is a consent banner needed?

For the inspected first-party implementation, there are no non-essential cookies to consent to, so a cookie opt-in banner is not currently indicated by the code reviewed. `localStorage` is not a cookie; its use should still be disclosed and limited to the stated interface purpose. Reassess before adding analytics, ad technology, cross-site tracking, or optional browser storage, and before serving jurisdictions that regulate those technologies differently. For California users, determine whether a covered business sells or shares personal information and provide the required opt-out and preference-signal handling if applicable. This is an implementation review, not a legal determination for every deployment.

## Third-party policies

- [OpenStreetMap tile usage policy](https://operations.osmfoundation.org/policies/tiles/)
- [OpenStreetMap copyright and attribution](https://www.openstreetmap.org/copyright)
- [Caltrans conditions of use](https://dot.ca.gov/conditions-of-use)
- [Caltrans privacy policy](https://dot.ca.gov/privacy-policy)
