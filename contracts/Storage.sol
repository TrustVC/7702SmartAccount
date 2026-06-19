// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

contract Storage {
    struct Item {
        uint id;
        string data;
        uint256 timestamp;
        bool exists;
    }

    address public beneficiary;
    address public holder;

    mapping(uint => Item) private items;
    uint private itemCount = 0;

    event ItemCreated(uint indexed id, string data, uint256 timestamp);
    event ItemUpdated(uint indexed id, string data, uint256 timestamp);
    event ItemDeleted(uint indexed id);
    event ItemRead(uint indexed id, string data, uint256 timestamp);

    constructor(address _beneficiary, address _holder) {
        beneficiary = _beneficiary;
        holder = _holder;
    }

    // CREATE
    function create(string memory _data) public returns (uint) {
        require(
            msg.sender == beneficiary || msg.sender == holder,
            "Storage: only beneficiary or holder can create items"
        );
        require(bytes(_data).length > 0, "Storage: data cannot be empty");

        itemCount++;
        items[itemCount] = Item({
            id: itemCount,
            data: _data,
            timestamp: block.timestamp,
            exists: true
        });

        emit ItemCreated(itemCount, _data, block.timestamp);
        return itemCount;
    }

    // READ
    function read(uint _id) public returns (string memory) {
        require(
            msg.sender == beneficiary || msg.sender == holder,
            "Storage: only beneficiary or holder can create items"
        );
        require(_id > 0 && _id <= itemCount, "Storage: item does not exist");
        require(items[_id].exists, "Storage: item has been deleted");

        Item memory item = items[_id];
        emit ItemRead(_id, item.data, item.timestamp);
        return item.data;
    }

    // UPDATE
    function update(uint _id, string memory _newData) public {
        require(
            msg.sender == beneficiary || msg.sender == holder,
            "Storage: only beneficiary or holder can create items"
        );
        require(_id > 0 && _id <= itemCount, "Storage: item does not exist");
        require(items[_id].exists, "Storage: item has been deleted");
        require(bytes(_newData).length > 0, "Storage: data cannot be empty");

        items[_id].data = _newData;
        items[_id].timestamp = block.timestamp;

        emit ItemUpdated(_id, _newData, block.timestamp);
    }

    // DELETE
    function remove(uint _id) public {
        require(
            msg.sender == beneficiary || msg.sender == holder,
            "Storage: only beneficiary or holder can create items"
        );
        require(_id > 0 && _id <= itemCount, "Storage: item does not exist");
        require(items[_id].exists, "Storage: item already deleted");

        items[_id].exists = false;
        emit ItemDeleted(_id);
    }

    // Helper function to check if item exists
    function exists(uint _id) public view returns (bool) {
        return _id > 0 && _id <= itemCount && items[_id].exists;
    }

    // Get total item count
    function getItemCount() public view returns (uint) {
        return itemCount;
    }
}
