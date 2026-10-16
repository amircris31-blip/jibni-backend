from odoo.exceptions import UserError
from odoo.tests import tagged
from odoo.tests.common import TransactionCase


@tagged("post_install", "-at_install")
class TestLoadingRequest(TransactionCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.warehouse = cls.env["stock.warehouse"].search(
            [("company_id", "=", cls.env.company.id)], limit=1
        )
        cls.stock = cls.warehouse.lot_stock_id
        cls.truck = cls.env["stock.location"].create(
            {"name": "Camion 01", "usage": "internal", "location_id": cls.warehouse.view_location_id.id}
        )
        cls.product = cls.env["product.product"].create({"name": "Eau 1,5L", "type": "product"})
        cls.env["stock.quant"]._update_available_quantity(cls.product, cls.stock, 100)

    def _request(self, qty):
        return self.env["planning.loading_request"].create(
            {
                "location_dest_id": self.truck.id,
                "line_ids": [(0, 0, {"product_id": self.product.id, "qty_requested": qty})],
            }
        )

    def test_full_flow_moves_stock_to_truck(self):
        request = self._request(30)
        self.assertTrue(request.name.startswith("LR/"))
        self.assertEqual(request.location_id, self.stock)
        self.assertEqual(request.line_ids.qty_available, 100)

        request.action_submit()
        request.action_validate()
        request.action_start_preparation()
        self.assertEqual(request.state, "preparing")
        self.assertEqual(request.picking_id.state, "assigned")

        request.line_ids.qty_prepared = 25
        request.action_load()
        self.assertEqual(request.state, "loaded")
        self.assertEqual(request.picking_id.state, "done")
        self.assertEqual(request.line_ids.qty_loaded, 25)
        self.assertEqual(self.product.with_context(location=self.truck.id).qty_available, 25)
        self.assertEqual(self.product.with_context(location=self.stock.id).qty_available, 75)

        request.action_done()
        self.assertEqual(request.state, "done")

    def test_validate_blocks_on_insufficient_stock(self):
        request = self._request(500)
        request.action_submit()
        with self.assertRaises(UserError):
            request.action_validate()

    def test_cannot_submit_empty_or_delete_validated(self):
        empty = self.env["planning.loading_request"].create({"location_dest_id": self.truck.id})
        with self.assertRaises(UserError):
            empty.action_submit()
        request = self._request(5)
        request.action_submit()
        request.action_validate()
        with self.assertRaises(UserError):
            request.unlink()

    def test_cancel_during_preparation_cancels_picking(self):
        request = self._request(10)
        request.action_submit()
        request.action_validate()
        request.action_start_preparation()
        request.action_cancel()
        self.assertEqual(request.state, "cancel")
        self.assertEqual(request.picking_id.state, "cancel")
