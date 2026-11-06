# Console design review

Direction: **Framed sheet**, seed **1389183635**, from the taste skill's app-screen run. No redraws. The frame uses a quiet campus-security blue-grey; the sheet stays white. IBM Plex Sans is bundled with its OFL license so the console works without a font CDN. There is no decorative stock photography or invented production data.

The screen's question is “Which emergency needs attention, and at which node?” Incident actions now lead the dashboard; node health sits beside them. Notifications take the operator directly to the affected node and saved incident. Node setup asks “Which location am I connecting?” and keeps phone/ESP32 pairing beside its saved location. The signature element is the node's real smoke, fire, medical and shooting state; unknown states remain unknown.

The redesign removes gradients, glow, radar ornament, excessive capitals and decorative telemetry labels. Navigation names the working destinations: Dashboard, Cameras, Notifications, Security nodes and Users. Existing camera/device API contracts and saved coordinates remain in place. Campus map presentation assets are removed; map bookmarks redirect to Notifications.

## Final app-screen critique

1. Emergency reports and actions are read before device detail. The open count and node connection count derive from received data.
2. The sheet uses equal gutters and a 24-pixel workspace gap; the phone stacks the incident feed before node health. The node setup form stacks above the preview for quick creation.
3. Colour marks emergency status, a connection state or an action. The product is named in the shell; the custom shield mark remains.
4. Repeated counts use the same snapshot. Notifications combine recent history with all open emergencies, including open reports older than the 100-report feed limit.
5. Zero counts remain zero; missing hardware observations show a dash. Offline updates visibly change the connection state and retain the last reports.
6. Hardware chips share the same state source as the live camera overlay. No decorative charts or invented signals are used.
7. Navigation folds at tablet/phone widths, has an expanded state, closes on Escape or outside click, and the page has no horizontal overflow in the checked widths.

Editorial assessment: hierarchy 8/10, navigation 8/10, consistency 8/10, responsive usability 8/10. The deliberately sparse notification view can leave a large unused area when only one incident exists. Metadata uses compact 12–13px type; this remains an operations screen rather than a marketing page. These are subjective design scores, not test results.

Browser review data was isolated and never written to the user's persistent database. No sample people, nodes, alerts or pairing codes were added to the application itself.
