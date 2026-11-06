// Room IDs are permanent keys; labels and positions follow the supplied floor plans.
globalThis.CampusMap = (() => {
  const floor = (id, label, rows) => ({ id, label, rows: rows.map(row => row.map(([id, label]) => ({ id, label }))) });
  const numbered = (prefix, start, count) => Array.from({ length: count }, (_, i) => {
    const label = prefix + (start + i); return [label.toLowerCase(), label];
  });
  const buildings = [
    { id: 'rg-birrey', label: 'RG Birrey', floors: [
      floor('1', 'First floor', [[['main-hall-1', 'Main Hall'], ...[101, 201, 301, 401, 501, 601, 701].map(n => ['r' + n, 'R' + n])]]),
      floor('2', 'Second floor', [[['main-hall-2', 'Main Hall (2nd Floor Faculty Room)'], ['r602', 'R602']]]),
      floor('3', 'Third floor', [[['main-hall-3', 'Main Hall (3rd Floor Faculty Room)']]])
    ] },
    { id: 'rsy', label: 'RSY', floors: [
      floor('1', 'First floor', [numbered('C', 101, 10), [['cafeteria', 'Cafeteria'],
        ['treasury-admissions-registrar', 'Treasury, Admissions, Registrar'], ['faculty', 'Faculty']]]),
      floor('2', 'Second floor', [numbered('C', 201, 10), [['learning-commons', 'Learning Commons'],
        ['avr', 'AVR'], ['library', 'Library']]])
    ] }
  ];
  const normalize = value => String(value ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
  const rooms = buildings.flatMap(building => building.floors.flatMap(floor => floor.rows.flat().map(room =>
    ({ ...room, key: `${building.id}/${floor.id}/${room.id}`, building, floor }))));
  const byLocation = new Map(rooms.map(room => [normalize(room.building.label) + '/' + normalize(room.label), room]));
  const locate = record => byLocation.get(normalize(record.building) + '/' + normalize(record.room)) || null;
  const buildingFor = record => buildings.find(b => normalize(b.label) === normalize(record.building));
  function connection(node, fresh = true) {
    if (!fresh) return 'unknown';
    if (node.video?.cameraConnected === true || node.audio?.connected === true) return 'online';
    if ((node.videoEnabled && node.video?.cameraConnected === false) ||
        (node.audio?.paired && node.audio.connected === false)) return 'offline';
    return 'unknown';
  }
  function feed(node, fresh = true) {
    if (!fresh) return { reason: 'Live status is unavailable. Wait for updates to reconnect.' };
    if (!node.videoEnabled) return { reason: 'This node has no configured camera feed.' };
    if (!node.video?.cameraConnected) return { reason: 'This node’s camera is disconnected.' };
    if (!node.video?.live) return { reason: 'The camera has no fresh video frames yet.' };
    return { href: '/cam-view?' + new URLSearchParams({ nodeId: node.nodeId }) };
  }
  function project(nodes, alerts) {
    const active = [...new Map(alerts.filter(a => a.status !== 'resolved').map(a => [String(a._id), a])).values()];
    const result = { rooms: new Map(rooms.map(room => [room.key, { ...room, nodes: [], alerts: [] }])),
      buildingCounts: new Map(buildings.map(b => [b.id, 0])), floorCounts: new Map(), unmappedNodes: [], unmappedAlerts: [], active };
    for (const node of nodes) {
      const room = locate(node);
      if (room) result.rooms.get(room.key).nodes.push(node); else result.unmappedNodes.push(node);
    }
    for (const alert of active) {
      const building = buildingFor(alert);
      if (building) result.buildingCounts.set(building.id, result.buildingCounts.get(building.id) + 1);
      // Use the incident's recorded location, even after its node is moved or deleted.
      const room = locate(alert);
      if (room) {
        result.rooms.get(room.key).alerts.push(alert);
        const key = `${room.building.id}/${room.floor.id}`;
        result.floorCounts.set(key, (result.floorCounts.get(key) || 0) + 1);
      } else result.unmappedAlerts.push(alert);
    }
    return result;
  }
  return { buildings, rooms, locate, connection, feed, project };
})();
