// Publisher announcements are not required for claiming rewards.
class EbnullNotifier {
  async getNotifications() {
    return { important: [], normal: [], counts: await this.getCounts() };
  }
  async getCounts() {
    return { all: 0, notRead: 0, notReadImportant: 0 };
  }
  async markRead() {}
}
