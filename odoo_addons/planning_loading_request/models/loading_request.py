from odoo import _, api, fields, models
from odoo.exceptions import UserError, ValidationError
from odoo.tools import float_compare


class LoadingRequest(models.Model):
    _name = "planning.loading_request"
    _description = "Demande de chargement"
    _inherit = ["mail.thread", "mail.activity.mixin"]
    _order = "date_planned desc, id desc"

    name = fields.Char(
        string="Référence", required=True, copy=False, readonly=True, default="/"
    )
    state = fields.Selection(
        [
            ("draft", "Brouillon"),
            ("submitted", "Soumise"),
            ("validated", "Validée"),
            ("preparing", "En préparation"),
            ("loaded", "Chargée"),
            ("done", "Clôturée"),
            ("cancel", "Annulée"),
        ],
        string="Statut",
        default="draft",
        required=True,
        tracking=True,
        copy=False,
    )
    date_planned = fields.Datetime(
        string="Date de chargement",
        required=True,
        default=fields.Datetime.now,
        tracking=True,
    )
    user_id = fields.Many2one(
        "res.users",
        string="Vendeur / demandeur",
        default=lambda self: self.env.user,
        tracking=True,
    )
    vehicle_id = fields.Many2one("fleet.vehicle", string="Véhicule", tracking=True)
    driver_id = fields.Many2one(
        "res.partner",
        string="Chauffeur",
        compute="_compute_driver_id",
        store=True,
        readonly=False,
        tracking=True,
    )
    company_id = fields.Many2one(
        "res.company", required=True, default=lambda self: self.env.company
    )
    warehouse_id = fields.Many2one(
        "stock.warehouse",
        string="Entrepôt",
        required=True,
        default=lambda self: self.env["stock.warehouse"].search(
            [("company_id", "=", self.env.company.id)], limit=1
        ),
        check_company=True,
    )
    location_id = fields.Many2one(
        "stock.location",
        string="Emplacement source",
        compute="_compute_location_id",
        store=True,
        readonly=False,
        required=True,
        check_company=True,
    )
    location_dest_id = fields.Many2one(
        "stock.location",
        string="Emplacement camion",
        required=True,
        check_company=True,
        help="Emplacement de stock qui représente le camion chargé.",
    )
    line_ids = fields.One2many(
        "planning.loading_request.line", "request_id", string="Lignes", copy=True
    )
    picking_id = fields.Many2one(
        "stock.picking", string="Transfert", readonly=True, copy=False
    )
    validated_by_id = fields.Many2one(
        "res.users", string="Validée par", readonly=True, copy=False
    )
    note = fields.Html(string="Notes")
    total_requested = fields.Float(
        string="Total demandé", compute="_compute_totals", digits="Product Unit of Measure"
    )
    total_loaded = fields.Float(
        string="Total chargé", compute="_compute_totals", digits="Product Unit of Measure"
    )

    @api.depends("vehicle_id")
    def _compute_driver_id(self):
        for request in self:
            if request.vehicle_id.driver_id:
                request.driver_id = request.vehicle_id.driver_id

    @api.depends("warehouse_id")
    def _compute_location_id(self):
        for request in self:
            request.location_id = request.warehouse_id.lot_stock_id

    @api.depends("line_ids.qty_requested", "line_ids.qty_loaded")
    def _compute_totals(self):
        for request in self:
            request.total_requested = sum(request.line_ids.mapped("qty_requested"))
            request.total_loaded = sum(request.line_ids.mapped("qty_loaded"))

    @api.model_create_multi
    def create(self, vals_list):
        for vals in vals_list:
            if vals.get("name", "/") == "/":
                vals["name"] = self.env["ir.sequence"].next_by_code(
                    "planning.loading_request"
                ) or "/"
        return super().create(vals_list)

    def unlink(self):
        if any(request.state not in ("draft", "cancel") for request in self):
            raise UserError(
                _("Seules les demandes en brouillon ou annulées peuvent être supprimées.")
            )
        return super().unlink()

    def _check_state(self, allowed):
        for request in self:
            if request.state not in allowed:
                raise UserError(
                    _("Action impossible sur %s au statut « %s ».")
                    % (request.name, dict(self._fields["state"].selection)[request.state])
                )

    def action_submit(self):
        self._check_state(("draft",))
        for request in self:
            if not request.line_ids:
                raise UserError(_("Ajoutez au moins une ligne avant de soumettre."))
        self.state = "submitted"

    def action_validate(self):
        self._check_state(("submitted",))
        for request in self:
            short = request.line_ids.filtered(
                lambda l: float_compare(
                    l.qty_requested, l.qty_available, precision_rounding=l.product_uom_id.rounding
                )
                > 0
            )
            if short:
                raise UserError(
                    _("Stock insuffisant pour : %s")
                    % ", ".join(short.mapped("product_id.display_name"))
                )
        self.write({"state": "validated", "validated_by_id": self.env.user.id})

    def action_start_preparation(self):
        self._check_state(("validated",))
        for request in self:
            request.picking_id = request._create_picking()
            request.picking_id.action_confirm()
            request.picking_id.action_assign()
            for line in request.line_ids:
                line.qty_prepared = line.qty_requested
        self.state = "preparing"

    def _create_picking(self):
        self.ensure_one()
        picking_type = self.warehouse_id.int_type_id
        return self.env["stock.picking"].create(
            {
                "picking_type_id": picking_type.id,
                "location_id": self.location_id.id,
                "location_dest_id": self.location_dest_id.id,
                "scheduled_date": self.date_planned,
                "origin": self.name,
                "company_id": self.company_id.id,
                "move_ids": [
                    (
                        0,
                        0,
                        {
                            "name": line.product_id.display_name,
                            "product_id": line.product_id.id,
                            "product_uom": line.product_uom_id.id,
                            "product_uom_qty": line.qty_requested,
                            "location_id": self.location_id.id,
                            "location_dest_id": self.location_dest_id.id,
                            "loading_line_id": line.id,
                        },
                    )
                    for line in self.line_ids
                ],
            }
        )

    def action_load(self):
        self._check_state(("preparing",))
        for request in self:
            picking = request.picking_id
            for move in picking.move_ids:
                line = move.loading_line_id
                move.quantity = line.qty_prepared
                move.picked = True
            picking.move_ids.filtered(lambda m: not m.quantity)._action_cancel()
            picking.with_context(
                skip_backorder=True, picking_ids_not_to_backorder=picking.ids
            ).button_validate()
            if picking.state != "done":
                raise UserError(_("Le transfert %s n'a pas pu être validé.") % picking.name)
            for line in request.line_ids:
                line.qty_loaded = line.qty_prepared
        self.state = "loaded"

    def action_done(self):
        self._check_state(("loaded",))
        self.state = "done"

    def action_cancel(self):
        self._check_state(("draft", "submitted", "validated", "preparing"))
        for request in self:
            if request.picking_id and request.picking_id.state != "done":
                request.picking_id.action_cancel()
        self.state = "cancel"

    def action_draft(self):
        self._check_state(("cancel", "submitted"))
        self.write({"state": "draft", "picking_id": False, "validated_by_id": False})
        self.line_ids.write({"qty_prepared": 0, "qty_loaded": 0})

    def action_view_picking(self):
        self.ensure_one()
        return {
            "type": "ir.actions.act_window",
            "res_model": "stock.picking",
            "res_id": self.picking_id.id,
            "view_mode": "form",
        }


class LoadingRequestLine(models.Model):
    _name = "planning.loading_request.line"
    _description = "Ligne de demande de chargement"
    _order = "sequence, id"

    request_id = fields.Many2one(
        "planning.loading_request", required=True, ondelete="cascade", index=True
    )
    sequence = fields.Integer(default=10)
    state = fields.Selection(related="request_id.state")
    company_id = fields.Many2one(related="request_id.company_id", store=True)
    product_id = fields.Many2one(
        "product.product",
        string="Produit",
        required=True,
        domain=[("type", "=", "product")],
        check_company=True,
    )
    product_uom_id = fields.Many2one(
        "uom.uom",
        string="Unité",
        compute="_compute_product_uom_id",
        store=True,
        readonly=False,
        required=True,
    )
    qty_requested = fields.Float(
        string="Qté demandée", digits="Product Unit of Measure", default=1.0
    )
    qty_prepared = fields.Float(string="Qté préparée", digits="Product Unit of Measure")
    qty_loaded = fields.Float(
        string="Qté chargée", digits="Product Unit of Measure", readonly=True
    )
    qty_available = fields.Float(
        string="Stock dispo", compute="_compute_qty_available", digits="Product Unit of Measure"
    )

    _sql_constraints = [
        (
            "qty_requested_positive",
            "CHECK(qty_requested > 0)",
            "La quantité demandée doit être positive.",
        ),
    ]

    @api.depends("product_id")
    def _compute_product_uom_id(self):
        for line in self:
            line.product_uom_id = line.product_id.uom_id

    @api.depends("product_id", "product_uom_id", "request_id.location_id")
    def _compute_qty_available(self):
        for line in self:
            if not line.product_id or not line.request_id.location_id:
                line.qty_available = 0.0
                continue
            qty = line.product_id.with_context(
                location=line.request_id.location_id.id
            ).free_qty
            line.qty_available = line.product_id.uom_id._compute_quantity(
                qty, line.product_uom_id or line.product_id.uom_id
            )

    @api.constrains("qty_prepared", "qty_requested")
    def _check_qty_prepared(self):
        for line in self:
            if line.qty_prepared < 0 or float_compare(
                line.qty_prepared,
                line.qty_requested,
                precision_rounding=line.product_uom_id.rounding,
            ) > 0:
                raise ValidationError(
                    _("La quantité préparée de %s doit être entre 0 et la quantité demandée.")
                    % line.product_id.display_name
                )


class StockMove(models.Model):
    _inherit = "stock.move"

    loading_line_id = fields.Many2one(
        "planning.loading_request.line", index="btree_not_null", copy=False
    )
