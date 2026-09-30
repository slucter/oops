const express = require('express');
const groupStore = require('../services/groupStore');

const router = express.Router();

function listWithCounts() {
  return groupStore.listGroups().map((g) => ({ ...g, memberCount: groupStore.countMembers(g.id) }));
}

router.get('/groups', (req, res) => {
  res.render('groups', { groups: listWithCounts(), error: null, username: req.session.username });
});

router.post('/groups', (req, res) => {
  try {
    groupStore.createGroup(req.body.name);
    res.redirect('/groups');
  } catch (err) {
    res.status(400).render('groups', { groups: listWithCounts(), error: err.message, username: req.session.username });
  }
});

router.post('/groups/:id/edit', (req, res) => {
  const id = Number(req.params.id);
  try {
    groupStore.updateGroup(id, req.body.name);
    res.redirect('/groups');
  } catch (err) {
    res.status(400).render('groups', { groups: listWithCounts(), error: err.message, username: req.session.username });
  }
});

router.post('/groups/:id/delete', (req, res) => {
  const id = Number(req.params.id);
  groupStore.deleteGroup(id);
  res.redirect('/groups');
});

module.exports = router;
