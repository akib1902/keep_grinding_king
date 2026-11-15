class Inventory{
    constructor(page){
        this.inventoryItems = page.locator('[data-test="inventory-item"]');
        this.cartBadge = page.locator('.shopping_cart_badge');
    }

    getProductCard(productName){
        return this.inventoryItems.filter({ hasText: productName });
    }

    async addProductToCart(productName){
        const product = this.getProductCard(productName);
        await product.getByRole('button', {name: 'Add to cart'}).click();
    }

    async getCartBadgeCount(){
        const hashBadge = await this.cartBadge.count();
        if(hashBadge === 0) return 0;
        return hashBadge;
    }
}
module.exports = {Inventory}