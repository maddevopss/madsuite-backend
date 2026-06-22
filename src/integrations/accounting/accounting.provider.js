/**
 * accounting.provider.js
 * 
 * Contrat d'interface (Interface de base) pour toute intégration comptable.
 * Toutes les implémentations (QuickBooks, Xero, Excel, etc.) doivent étendre cette classe.
 */

class AccountingProvider {
  constructor(organisationId) {
    if (this.constructor === AccountingProvider) {
      throw new Error("Cannot instantiate abstract class AccountingProvider");
    }
    this.organisationId = organisationId;
  }

  /**
   * Synchronise une facture vers le système comptable.
   * @param {Object} invoice La facture interne à MADSuite
   * @returns {Promise<boolean>} Succès ou échec
   */
  async syncInvoice(invoice) {
    throw new Error("Method 'syncInvoice()' must be implemented.");
  }

  /**
   * Synchronise un paiement de facture vers le système comptable.
   * @param {Object} invoice La facture interne
   * @param {string} paymentMethod La méthode de paiement
   * @returns {Promise<boolean>} Succès ou échec
   */
  async syncPayment(invoice, paymentMethod) {
    throw new Error("Method 'syncPayment()' must be implemented.");
  }

  /**
   * Synchronise un client vers le système comptable.
   * @param {Object} client Le client interne
   * @returns {Promise<boolean>} Succès ou échec
   */
  async syncClient(client) {
    throw new Error("Method 'syncClient()' must be implemented.");
  }
}

module.exports = AccountingProvider;
