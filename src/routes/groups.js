const express = require('express');
const groupStore = require('../services/groupStore');

const router = express.Router();

router.get('/groups', (req, res) => {
  const groups = groupStore.listGroups().map((g) => ({ ...g, memberCount: groupStore.countMembers(g.id) }));
  res.render('groups', { groups, error: null });
});

router.post('/groups', (req, res) => {
  try {
    groupStore.createGroup(req.body.name);
    res.redirect('/groups');
  } catch (err) {
    const groups = groupStore.listGroups().map((g) => ({ ...g, memberCount: groupStore.countMembers(g.id) }));
    res.status(400).render('groups', { groups, error: err.message });
  }
});

router.post('/groups/:id/edit', (req, res) => {
  const id = Number(req.params.id);
  try {
    groupStore.updateGroup(id, req.body.name);
    res.redirect('/groups');
  } catch (err) {
    const groups = groupStore.listGroups().map((g) => ({ ...g, memberCount: groupStore.countMembers(g.id) }));
    res.status(400).render('groups', { groups, error: err.message });
  }
});

router.post('/groups/:id/delete', (req, res) => {
  const id = Number(req.params.id);
  groupStore.deleteGroup(id);
  res.redirect('/groups');
});

module.exports = router;
