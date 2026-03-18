const admin = require('firebase-admin');

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: "jibni-3",
      clientEmail: "firebase-adminsdk-fbsvc@jibni-3.iam.gserviceaccount.com",
      privateKey: "-----BEGIN PRIVATE KEY-----\nMIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQDeXv/Dr1nosgr4\n/pgEr8Mhlzlpva+QW0dK8g5iMP/wGyh2fFL4/XXo1UEKBJ1kHuBcr/+KUCwBqReC\nL73QffAHDPPHefF1HGxFPmyhzOnVZMBMlllSwiWYZAZ6j9mHbyT2okx7LxEipUUs\nCknQV/ahYg45r6h2TVKL1cryH6I4iz9yKosspcNtGeCLzMbaoaFpY64S0sWJDyKT\nwjDJzxd985ZwumN5iM/nqlxlWSpsKg7qlGjx+y881Quena2WQMesNIOMIShw0ueH\n9irSDagq/sskXF8uBg2hfPMsHksdk+xazc1OjG6xBDxGyZ+y+/n46eqAW5e0IYJa\nX1gBdx3xAgMBAAECggEAG9zr78VUPvG2KcJe4nFygg48iakUq0Igsf2X+0o3+4ov\nnP8Rd3Ts1gaIjnyLCx1KUBrWamqGxRN+qFeakVoCXiPLlPJM5LdxwpBilLiEETK9\nXKtXGGVOyCQ6YpeNMmjlCQlHi4TXgQ+T1gOZAaPP+aM7dJNzyJUCM5bPhdycWzit\npyHncso7mys64BJtUdeK0DNJeH0zSpZSW0KHPCyBZf/4VMHQ/htToPPup/OjgccZ\nOquz2gzL9LbqMDh5Sq/EN7CdAu7uX6E5Sxt0+vfGgd6BUmAgGhYfAHkJ3UIz/c/N\n1euTN+LRzjO0+z8NGLGBLbXxxa+r+awjC8THyCiiBQKBgQDyRKeOcghANzvgcQci\nuQS0oVJ3kVfxz5WegbVSL86zEMn9nREgRYFvzoI23jTpY3jh30oQE11dD9jzdscM\nElbR7BHFD4Q7EljqZnryF44ighvIRti+TBGN1LaiMSL1pKH3crnDYHz3flNlGt0S\nYH5RpfIKwZi1UnJC1jbMG9bgpQKBgQDq+aKMmkQHRSXhY1BzU5UwUHI9QRswgejn\nxdzQTTXc2Mw3z7iDysfHdx+p5GBaRcigg955RJmwrZHEjloQTEHYRq0PgjvqyZUb\nAmRoG9tjKQXT2XyJcLqY1JMt2Eo0yv7ztQZDUvLlTJDFfzTj7xQ0bsW61H/qa/gA\n3ZS+tr/aXQKBgQC5E721UmP/OrLhaTd8TT/NBhjMAxrePikc6BYu7RrJLSBCQQVe\nU/roASj05ZgiW71zQHOCCGkguQSSKcEx9aihwehpVMs9nWyT1SpDW79XmXHD9GuM\nJOycH05OZZ9BbT3WnaxQF5wgLj9jU7xjV5fopA9eLDuO+acUbDV8hCAJiQKBgCgK\nokiTgUQ75FikM/FzLNku3EjT7240tRvJ+/cDMUqRJzvbifXreF/lTOAGquS3P5ka\n366KoiYZbd2w5GgilpXkdVlPOCaqc15G6hVTqe8b7oJLbY1+SE4C65HEaeDVNt0Q\n3CBc4kdw5LrDEqBE/Yxx1AAidincfEape8+EFO2BAoGBANuiohHRIyl7Ngv2mYrG\n4jRVNiqAVoOHx/+MDVMKC0SqvWB80bIIOPdjpMm1aCfLS/rfgqA9WReFfuUsygso\ndn1sVdfHYpQ8WAyHkDbECjPQXdE+pt6US68jvkqmPITUbyG9u0VfsZ+7MsG5QjHY\nc+fUpMkhcpyew+kRVc60rhB4\n-----END PRIVATE KEY-----\n"
    })
  });
}

const db = admin.firestore();

function getDistance(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2-lat1) * Math.PI/180;
  const dLon = (lon2-lon1) * Math.PI/180;
  const a = Math.sin(dLat/2)*Math.sin(dLat/2) +
    Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*
    Math.sin(dLon/2)*Math.sin(dLon/2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

async function dispatchCourse(courseId, courseData) {
  const typeKey = courseData.vehicleType?.includes('Van') ? 'van' :
                  courseData.vehicleType?.includes('Berline') ? 'cft' : 'std';

  const snap = await db.collection('chauffeurs')
    .where('status', '==', 'approved')
    .where('online', '==', true)
    .get();

  let drivers = snap.docs.map(d => ({ id: d.id, ...d.data() }))
    .filter(d => {
      const cats = d.rideCategories || { std: true, cft: false, van: false };
      return typeKey === 'van' ? cats.van : typeKey === 'cft' ? cats.cft : cats.std;
    })
    .filter(d => d.latitude && d.longitude);

  if (courseData.originLat && courseData.originLon) {
    drivers.sort((a, b) => {
      const da = getDistance(courseData.originLat, courseData.originLon, a.latitude, a.longitude);
      const db2 = getDistance(courseData.originLat, courseData.originLon, b.latitude, b.longitude);
      return da - db2;
    });
  }

  console.log(`Dispatch ${courseId}: ${drivers.length} chauffeurs`);
  if (drivers.length > 0) await sendToNextDriver(courseId, drivers, 0, courseData);
  else {
    await db.collection('courses').doc(courseId).update({ status: 'no_driver', updatedAt: new Date() });
  }
}

async function sendToNextDriver(courseId, drivers, index, courseData) {
  if (index >= drivers.length) {
    await db.collection('courses').doc(courseId).update({ status: 'no_driver', updatedAt: new Date() });
    return;
  }

  const driver = drivers[index];
  console.log(`Course ${courseId} → chauffeur ${index+1}/${drivers.length}: ${driver.id}`);

  await db.collection('courses').doc(courseId).update({
    notifiedDriverId: driver.id,
    notifiedDriverIndex: index,
    notifiedAt: new Date()
  });

  if (driver.pushToken) {
    await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        to: driver.pushToken,
        sound: 'default',
        title: '🚕 Nouvelle course !',
        body: `De: ${courseData.origin}\nVers: ${courseData.destination}\n${courseData.vehicleType} · ${courseData.price}€`,
        data: { type: 'new_course', courseId },
        priority: 'high',
      })
    });
  }

  setTimeout(async () => {
    try {
      const snap = await db.collection('courses').doc(courseId).get();
      const course = snap.data();
      if (course?.status === 'pending' && course?.notifiedDriverId === driver.id) {
        console.log(`Timeout chauffeur ${driver.id}, passage au suivant`);
        await sendToNextDriver(courseId, drivers, index + 1, courseData);
      }
    } catch(e) { console.log('Timeout error:', e); }
  }, 30000);
}

module.exports = { dispatchCourse };
